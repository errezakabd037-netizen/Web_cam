const createBtn = document.getElementById("create");
const closeBtn = document.getElementById("close");
const qr = document.getElementById("qr");
const placeholder = document.getElementById("qr-placeholder");
const statusEl = document.getElementById("status");
const message = document.getElementById("message");
const video = document.getElementById("remoteVideo");
const quality = document.getElementById("quality");

let session = null;
let socket = null;
let pc = null;
let pendingIce = [];

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setStatus(text) { statusEl.textContent = text; }
function send(type, data = null) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
}
function createPeer() {
  if (pc) pc.close();
  pc = new RTCPeerConnection(rtcConfig);
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (event) => {
    video.srcObject = event.streams[0];
    quality.textContent = "Live video connected";
    setStatus("Streaming");
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) send("ice-candidate", event.candidate);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") setStatus("Streaming");
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      setStatus("Connection interrupted");
      message.textContent = "The connection was interrupted. Try reconnecting.";
    }
  };
}

async function startSession() {
  createBtn.disabled = true;
  message.textContent = "Creating a secure temporary session…";
  try {
    const response = await fetch("/api/sessions", { method: "POST" });
    if (!response.ok) throw new Error("Could not create session");
    session = await response.json();
    qr.src = session.qrDataUrl;
    qr.hidden = false;
    placeholder.hidden = true;
    closeBtn.disabled = false;
    setStatus("Waiting for phone");
    message.textContent = "Scan the QR code with your phone. It expires in 5 minutes.";
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal?room=${encodeURIComponent(session.room)}&token=${encodeURIComponent(session.desktopToken)}&role=desktop`);
    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      try {
        if (msg.type === "peer-joined") {
          message.textContent = "Phone connected. Waiting for camera approval and video…";
          if (!pc) createPeer();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send("offer", pc.localDescription);
        } else if (msg.type === "answer" && pc) {
          await pc.setRemoteDescription(msg.data);
          for (const candidate of pendingIce) await pc.addIceCandidate(candidate);
          pendingIce = [];
        } else if (msg.type === "ice-candidate" && pc) {
          if (pc.remoteDescription) await pc.addIceCandidate(msg.data);
          else pendingIce.push(msg.data);
        } else if (msg.type === "peer-left") {
          setStatus("Phone disconnected");
          message.textContent = "The phone disconnected.";
          video.srcObject = null;
          if (pc) { pc.close(); pc = null; }
        }
      } catch (error) {
        console.error(error);
        message.textContent = "Connection setup failed. Please create a new session.";
      }
    };
    socket.onopen = () => { message.textContent = "QR ready. Scan it with your phone."; };
    socket.onerror = () => { message.textContent = "Signaling connection failed. Check the server."; };
  } catch (error) {
    message.textContent = error.message;
    createBtn.disabled = false;
  }
}

async function endSession() {
  if (!session) return;
  send("hangup");
  socket?.close();
  pc?.close();
  pc = null;
  video.srcObject = null;
  await fetch(`/api/sessions/${session.room}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desktopToken: session.desktopToken })
  }).catch(() => {});
  session = null;
  socket = null;
  qr.hidden = true;
  placeholder.hidden = false;
  createBtn.disabled = false;
  closeBtn.disabled = true;
  setStatus("Not connected");
  quality.textContent = "Waiting for stream";
  message.textContent = "Session ended. Generate a new QR code to connect again.";
}
createBtn.addEventListener("click", startSession);
closeBtn.addEventListener("click", endSession);
