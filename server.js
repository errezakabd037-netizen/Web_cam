const express = require("express");
const http = require("http");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/signal" });
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const sessions = new Map();

app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));

function token() {
  return crypto.randomBytes(32).toString("base64url");
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now || session.closed) {
      for (const peer of Object.values(session.peers)) {
        if (peer && peer.readyState === WebSocket.OPEN) peer.close(1000, "Session expired");
      }
      sessions.delete(id);
    }
  }
}
setInterval(cleanupSessions, 30_000).unref();

app.post("/api/sessions", async (_req, res) => {
  cleanupSessions();
  const id = crypto.randomBytes(6).toString("hex");
  const desktopToken = token();
  const phoneToken = token();
  const phoneUrl = new URL("/phone.html", PUBLIC_URL);
  phoneUrl.searchParams.set("room", id);
  phoneUrl.searchParams.set("token", phoneToken);

  const session = {
    id,
    desktopToken,
    phoneToken,
    expiresAt: Date.now() + 5 * 60_000,
    peers: { desktop: null, phone: null },
    closed: false
  };
  sessions.set(id, session);

  try {
    const qrDataUrl = await QRCode.toDataURL(phoneUrl.toString(), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280
    });
    res.json({ room: id, desktopToken, phoneUrl: phoneUrl.toString(), qrDataUrl, expiresInSeconds: 300 });
  } catch (error) {
    sessions.delete(id);
    console.error("QR generation failed:", error);
    res.status(500).json({ error: "Could not create QR code" });
  }
});

app.post("/api/sessions/:room/close", (req, res) => {
  const session = sessions.get(req.params.room);
  if (!session || req.body?.desktopToken !== session.desktopToken) {
    return res.status(404).json({ error: "Session not found" });
  }
  session.closed = true;
  for (const peer of Object.values(session.peers)) {
    if (peer && peer.readyState === WebSocket.OPEN) peer.close(1000, "Session closed by desktop");
  }
  sessions.delete(session.id);
  res.json({ ok: true });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const room = url.searchParams.get("room");
  const suppliedToken = url.searchParams.get("token");
  const role = url.searchParams.get("role");
  const session = sessions.get(room);

  if (!session || session.expiresAt < Date.now() || !["desktop", "phone"].includes(role)) {
    ws.close(1008, "Invalid or expired session");
    return;
  }

  const expectedToken = role === "desktop" ? session.desktopToken : session.phoneToken;
  if (suppliedToken !== expectedToken || session.peers[role]) {
    ws.close(1008, "Unauthorized or peer already connected");
    return;
  }

  session.peers[role] = ws;
  ws.role = role;
  ws.room = room;

  const otherRole = role === "desktop" ? "phone" : "desktop";
  const other = session.peers[otherRole];
  if (other && other.readyState === WebSocket.OPEN) {
    other.send(JSON.stringify({ type: "peer-joined", role }));
    ws.send(JSON.stringify({ type: "peer-joined", role: otherRole }));
  }

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const allowed = new Set(["offer", "answer", "ice-candidate", "hangup"]);
    if (!message || !allowed.has(message.type)) return;

    const peer = session.peers[otherRole];
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify({ type: message.type, data: message.data ?? null }));
    }
  });

  ws.on("close", () => {
    if (session.peers[role] === ws) session.peers[role] = null;
    const peer = session.peers[otherRole];
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify({ type: "peer-left" }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`PhoneCam running at ${PUBLIC_URL}`);
});
