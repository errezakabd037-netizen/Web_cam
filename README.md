# PhoneCam — Phase 1

PhoneCam streams a phone camera to a computer browser using WebRTC. The phone must explicitly tap the connect button and approve camera permission.

## Requirements
- Node.js 18 or newer
- A modern browser on the computer and phone

## Run locally
```powershell
npm install
npm run dev
```
Open `http://localhost:3000` on the computer.

## Important: current phase limitation
This is the first working architecture prototype. It uses a public STUN server, which is not enough to guarantee connections across every mobile carrier, router, or strict NAT/firewall. For reliable "anywhere" use, Phase 2 must deploy the app over HTTPS and add TURN relay service credentials (for example, a managed TURN provider or a properly secured coturn server). Do not expose a TURN server without authentication and usage limits.

## Security notes
- A new session uses separate random desktop and phone tokens.
- The QR token expires after five minutes.
- The phone camera starts only after a user tap and browser permission.
- No video is recorded or stored by this prototype.
- The signaling server relays WebRTC setup messages; media is peer-to-peer when the network permits, otherwise TURN will relay it once configured.

## Phase 1 test
For a first test on one Wi-Fi network, open the app on the computer using `localhost`, but note that the phone cannot use the computer's `localhost`. Use the computer's LAN IP and HTTPS for camera permission on the phone, or deploy the app to an HTTPS host. Browsers generally require a secure context (HTTPS) for camera access, with localhost as a special case.
