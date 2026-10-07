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

`scripts/browser-smoke.mjs` exercises the complete UI against a real local LiveKit server with synthetic camera/microphone devices (requires Playwright/Chromium). `bash scripts/media-ci.sh` downloads the pinned server, verifies its checksum and runs that check. The full check passed on GitHub Actions, including video to two viewers, chat, reporting, removal and cleanup. It does not record media or screenshot live streams. See `VALIDATION.md` for the exact tested scope.

This is not a finished public social app. Remaining: deployed media/backend connections and cross-network phone verification; email verification/recovery and meaningful age checks; complete profile/follow/discovery features; persistent bans and full moderation workflow; PK/cohosting; gifts/coin ledger, payments and payouts with server-side reconciliation. There is no simulated money or fake live activity in this build.

## Account provider setup (Veya only)

Google and Facebook are implemented but hidden until their Veya credentials are configured. Existing email accounts remain usable. A social identity is never linked just because its email matches: sign in to the existing account and use Account settings to connect the provider. New social accounts must explicitly acknowledge being 18+. This is acknowledgement, not age verification.

Google: create a Web application OAuth client in a separate Veya Google Cloud project, with `openid email profile` scopes. Authorized redirect URI: `https://veya-backend-development.up.railway.app/auth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` privately in the Veya Railway service. Configure consent-screen audience/test users before external use.

Facebook: create a separate Veya Meta developer app with Facebook Login. Redirect URI: `https://veya-backend-development.up.railway.app/auth/facebook/callback`. Set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and the supported `FACEBOOK_API_VERSION` shown in your app dashboard. Request only public profile and email. Meta's app-mode, permission, privacy-policy and deletion requirements must be completed before opening it to everyone. No tokens are stored or exposed to the frontend.

Email: set separate `RESEND_API_KEY` and `EMAIL_FROM` values using a verified Veya sender. Delivery is not active until configured. Resend's test sender can only send to the account owner's address; general delivery needs a verified sender domain, which has not been purchased or configured. Do not use TLOU's account, keys, or domain. Once email delivery is enabled, unverified accounts cannot enter live rooms. Google-verified email is accepted; Facebook email is not automatically treated as verified. Existing email accounts also need to verify.

Verification and reset links have one-use hashed tokens, expire after 60/30 minutes, and reset revokes all sessions. Link tokens are in the URL fragment and cleared before further navigation. Send requests return the same message for unknown accounts. Delivery has a per-address cooldown and 100-request daily guard per running instance; this is not a provider billing cap. Provider callbacks use browser-bound, one-use state, with PKCE and nonce validation for Google.

Status: automated security and local browser checks cover code behavior. Google sign-in and host publishing have been confirmed by the owner on the hosted Veya build. Facebook and email delivery still require configuration and live checks. SMS and WhatsApp verification are not enabled.

## Profile setup and Explore

New and existing accounts without a completed profile enter a two-step setup: display name, optional photo/bio, explicit 18+ acknowledgement when needed, then optional interests. Profiles persist in the existing SQLite volume. Client photos are cropped and re-encoded to 256px JPEG; the API caps the request and permits only raster JPG/PNG data with matching signatures. No SVG or remote photo URL is accepted. Editing is authenticated, origin checked and blocked while that account has a live room.

Explore lists real live rooms with title and host search. Empty states contain no fabricated activity. My profile contains editing, account connections and sign-out; Go live requires a room title and has its own setup screen. Room privacy, moderation and media permissions are retained.

Live gifts use an isolated test-credit ledger. Each approved member starts with 250 free test credits, can send one of four illustrated gifts to another current room participant, and can see their balance and illustrated history in Profile. Sending requires confirmation; a successful gift briefly animates in the camera view of everyone in the room and appears in room chat. Hosts see test gifts received in their host hub; moderators can inspect the latest gift transactions. Transfers are atomic and idempotent. Test credits and gifts have no monetary value, purchase flow, conversion or payout.

## Tester and host access

All accounts select a country/region from Unicode CLDR territory data. Country is self-reported and appears only in the account's own setup and admin management. Newly created and existing accounts are viewers by default; testing access requires explicit approval, and streaming requires separate host approval. Owner IDs are configured privately using `ADMIN_USER_IDS`; owner status is never granted to the first signup or inferred from an unverified email. Until an owner is configured, accounts can sign in and complete profiles but cannot enter rooms. The account ID appears in My profile to support secure owner setup.

Admin management supports tester approvals, optional-field host applications, manual external auditions, trials and host decisions. New hosts must start a trial. Defaults are 15 days and pause for review at expiry; these are editable. Trial duration changes apply to new/extended trials, while expiry outcome uses the current setting. Paid trial amount, required hours/days and daily cap are planning settings only: no coin purchases, gift transfers, eligibility calculations or withdrawals are enabled. Live sessions track connected host time from media readiness through end/heartbeat; this is not yet a payout calculation.

Owner grants separate testers/hosts/moderation/settings/appeals permissions. Every management mutation is audited. Account/phone/IP suspensions support expiry and grouped lifting, and close affected room connections. Phone is optional and unverified; phone blocking cannot establish identity or stop a user signing up without that number. IP blocking uses Railway's documented edge-injected `X-Real-IP` only in a Railway environment and does not trust arbitrary forwarded headers locally. IP and phone blocks also block the selected account; shared IP addresses may affect other users. Suspended accounts can sign in to submit in-app appeals; admins reply and mark reviewed. WhatsApp contact integration is pending a contact number.
