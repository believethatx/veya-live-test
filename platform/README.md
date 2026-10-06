# Veya Live — working room development

This branch contains the application backend and mobile web client. The GitHub Pages site on `main` remains a separate older demonstration; it cannot run this Node backend.

## Implemented

- SQLite accounts with password hashes, HTTP-only sessions and sign-out that closes the affected room connection.
- LiveKit host video/audio and multiple viewers. Viewer tokens cannot publish camera, microphone, screen share or data. Host tokens only publish camera and microphone.
- Discovery only after the server verifies the host's camera track with LiveKit. Viewer counts only include clients whose LiveKit connection has been verified.
- Live chat with server-derived display names, message limits and safe text rendering.
- Invite links, microphone toggle, mobile sound-unlock control and host viewer removal.
- Privacy rules before joining/hosting, viewer watermarks and no Veya recording/replay/download/capture functionality.
- Durable text reports, owner-only report review and ending an active room. Admin authority uses explicitly configured existing user IDs, never an unverified email address.
- Authenticated LiveKit webhooks to reject participants without active app membership, remove blocked participants and close stale rooms.

## Run

Requires Node 24 or later. Run `npm ci`, `npm run build`, `npm test`, then `npm start`.

Copy `.env.example` to a local environment file and supply it with `node --env-file=.env server.mjs`, or configure the variables on the host. Never commit keys or paste API secrets into chat.

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: from the LiveKit project, server-side only. The browser receives only a scoped short-lived participant token.
- `APP_ORIGIN`: exact public HTTPS origin. The proxy must forward WebSocket upgrades and `X-Forwarded-Proto` correctly.
- `DATA_FILE`: persistent, private volume location for the SQLite database. A temporary filesystem will lose accounts/reports on redeploy.
- `ADMIN_USER_IDS`: comma-separated existing owner account IDs, configured by the operator after creating the owner's account. Do not use emails as proof of ownership.
- In LiveKit configure a webhook to `https://your-app-host/api/livekit/webhook`, signed with the configured API key. This is required for the full removal/room cleanup behavior, especially when self-hosting LiveKit.

Run one app replica; the live room registry is in memory. Redeploying closes active rooms. Capacity is currently 50 viewers per room and is also subject to the LiveKit project quota. Nothing upgrades a paid plan automatically.

## Privacy and capture limits

Recording and screenshots are prohibited by the room rules. This app has no capture or storage path for video/audio and grants no room recording permission to participants. The `display-capture` Permissions Policy prevents this page from invoking screen sharing where supported; it does **not** stop a device or another application from recording this page.

Browser apps cannot guarantee screenshot or screen recording prevention. Watermarks, removal and reporting deter misuse; they are not technical capture prevention. No automatic capture detection or screenshot notification is claimed.

A future native Android client can use `FLAG_SECURE`; a future iOS client can react to OS capture state and pause media, but screenshot notifications arrive after the screenshot. Even native protection cannot prevent another camera filming a screen. Those native protections are not implemented in this web build.

## Validation and remaining work

`npm test` verifies real HTTP/WebSocket clients with a fake media adapter, plus signed LiveKit token permissions, room membership, privacy consent, report access, moderation and logout. The fake adapter is test-only and is never selected by environment configuration.

`scripts/browser-smoke.mjs` additionally exercises the complete UI against a real local LiveKit server with synthetic camera/microphone devices (requires Playwright/Chromium). It does not record media or screenshot live streams.

This is not a finished public social app. Remaining: deployed media/backend connections and cross-network phone verification; email verification/recovery and meaningful age checks; complete profile/follow/discovery features; persistent bans and full moderation workflow; PK/cohosting; gifts/coin ledger, payments and payouts with server-side reconciliation. There is no simulated money or fake live activity in this build.
