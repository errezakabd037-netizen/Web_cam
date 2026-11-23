const params = new URLSearchParams(location.search);
const room = params.get("room");
const authToken = params.get("token");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const video = document.getElementById("localVideo");
const statusEl = document.getElementById("phoneStatus");
const message = document.getElementById("phoneMessage");

let stream = null;
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
  pc = new RTCPeerConnection(rtcConfig);
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  pc.onicecandidate = event => {
    if (event.candidate) send("ice-candidate", event.candidate);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setStatus("Connected");
      message.textContent = "Your camera is streaming to the computer.";
    }
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      setStatus("Connection interrupted");
      message.textContent = "Connection interrupted. Stop and reconnect.";
    }
  };
}

async function start() {
  if (!room || !authToken) {
    message.textContent = "This QR link is invalid. Scan a fresh code from the computer.";
    startBtn.disabled = true;
    return;
  }
  startBtn.disabled = true;
  message.textContent = "Requesting camera permission…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    stopBtn.disabled = false;
    setStatus("Camera approved");
    message.textContent = "Camera is on. Connecting securely to your computer…";

    const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${wsProtocol}://${location.host}/signal?room=${encodeURIComponent(room)}&token=${encodeURIComponent(authToken)}&role=phone`);
    socket.onopen = () => {
      createPeer();
      message.textContent = "Camera ready. Waiting for the computer…";
    };
    socket.onmessage = async event => {
      const msg = JSON.parse(event.data);
      try {
        if (msg.type === "offer") {
          if (!pc) createPeer();
          await pc.setRemoteDescription(msg.data);
          for (const candidate of pendingIce) await pc.addIceCandidate(candidate);
          pendingIce = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send("answer", pc.localDescription);
        } else if (msg.type === "ice-candidate" && pc) {
          if (pc.remoteDescription) await pc.addIceCandidate(msg.data);
          else pendingIce.push(msg.data);
        } else if (msg.type === "peer-left") {
          setStatus("Computer disconnected");
          message.textContent = "The computer ended the session.";
        } else if (msg.type === "hangup") {
          stop();
        }
      } catch (error) {
        console.error(error);
        message.textContent = "Could not establish the video connection.";
      }
    };
    socket.onerror = () => { message.textContent = "Could not connect to the PhoneCam server."; };
  } catch (error) {
    console.error(error);
    message.textContent = error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access in your browser settings and try again."
      : `Camera error: ${error.message}`;
    startBtn.disabled = false;
    setStatus("Permission needed");
  }
}

function stop() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  socket?.close();
  pc?.close();
  socket = null;
  pc = null;
  pendingIce = [];
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("Stopped");
  message.textContent = "Camera stopped and connection closed.";
}
startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
window.addEventListener("beforeunload", () => {
  if (stream) stream.getTracks().forEach(track => track.stop());
  socket?.close();
});
