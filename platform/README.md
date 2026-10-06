# Veya Live platform development

This branch starts the real room service. It has local database accounts and sessions, a mobile web interface, lists only connected hosts, uses WebSocket signaling and WebRTC for one host and one viewer, relays room chat, and ends a room when its host leaves. It is **not ready for public use**.

Run `npm install`, `npm test`, and `npm start`. Open `http://localhost:3000`. Camera capture requires HTTPS outside localhost. A reverse proxy must pass WebSocket upgrades and preserve the host and forwarded protocol.

Current limitations: no email verification, meaningful age verification, account recovery, durable messages, moderation, TURN relay, scalable media server, gifts, payments or payouts. The in-memory room state disappears after server restart. The STUN-only peer connection can fail across restrictive networks. Do not deploy publicly or connect real money until the safety and economy services are built and independently tested.
