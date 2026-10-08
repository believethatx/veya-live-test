# Veya Live — mobile web tester

This branch contains the Veya backend and mobile web client. The GitHub Pages site on `main` is a separate older demonstration; it cannot run this Node backend. The live tester is `https://veya-backend-development.up.railway.app`.

## Implemented

- SQLite accounts with password hashes, HTTP-only sessions and sign-out that closes the affected room connection.
- Signed-in email account holders can change their password with the current password; all sessions are revoked and open calls/rooms are closed. The account form rate-limits attempts.
- LiveKit host video/audio and multiple viewers. Viewer tokens cannot publish camera, microphone, screen share or data. Host tokens only publish camera and microphone.
- Discovery only after the server verifies the host's camera track with LiveKit. Viewer counts only include clients whose LiveKit connection has been verified.
- Live chat with server-derived display names, message limits and safe text rendering.
- Invite links, microphone toggle, mobile sound-unlock control and host viewer removal.
- Privacy rules before joining/hosting, viewer watermarks and no Veya recording/replay/download/capture functionality.
- Durable text reports, owner-only report review and ending an active room. Admin authority uses explicitly configured existing user IDs, never an unverified email address.
- Moderators can see every currently live room and end a broadcast directly from the Reports section, even before a viewer files a report.
- Authenticated LiveKit webhooks to reject participants without active app membership, remove blocked participants and close stale rooms.
- Original Live / Hosts / People discovery, public profiles, follow lists, Moments, direct messages and a host hub.
- Moment replies with a per-account posting limit, author/owner removal and profile-admin removal. Removing a Moment also removes its replies. Viewers can report a Moment; moderators review a private, deduplicated report and can remove the content. Report evidence stays after removal.
- Recipients can report a specific abusive direct message. Only that selected message and the reporter's explanation enter the moderation queue; other private messages are not exposed to admins.
- Approved hosts can opt into private test calls. Viewers request a call, the host accepts or declines, and both participants connect camera and microphone through a separate LiveKit room. Call access is gated by tester and host approval, blocking and active-room status. Calls have a 45-second ring timeout and a 30-minute active limit. There is no billing for calls.
- A live host can invite one other approved host already watching the room onto camera. The guest explicitly accepts, publishes camera/microphone after LiveKit permission changes, and can leave the camera while remaining a viewer. The host can remove the guest camera or remove that account from the room. Guest time counts toward host activity only after the guest camera becomes live.
- With a guest on camera, the host can start a three-minute battle. Only confirmed test gifts from viewers to the two hosts during that battle add to the score. Finished scores are saved in each host’s hub. The segment ends on timeout or if the guest leaves. There are no cash prizes, conversion, wagers or payouts.
- Home-screen install metadata and Veya app icons for the mobile web tester. The service worker stores only the public offline page and icon; it never caches API responses, profiles, chats or live media. Offline users see a reconnect screen because lives and messages require a connection.

## Run

Requires Node 24 or later. Run `npm ci`, `npm run build`, `npm test`, then `npm start`.

Copy `.env.example` to a local environment file and supply it with `node --env-file=.env server.mjs`, or configure the variables on the host. Never commit keys or paste API secrets into chat.

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: from the LiveKit project, server-side only. The browser receives only a scoped short-lived participant token.
- `APP_ORIGIN`: exact public HTTPS origin. The proxy must forward WebSocket upgrades and `X-Forwarded-Proto` correctly.
- `DATA_FILE`: persistent, private volume location for the SQLite database. A temporary filesystem will lose accounts/reports on redeploy.
- `ADMIN_USER_IDS`: comma-separated existing owner account IDs, configured by the operator after creating the owner's account. Do not use emails as proof of ownership.
- In LiveKit configure a webhook to `https://your-app-host/api/livekit/webhook`, signed with the configured API key. This is required for the full removal/room cleanup behavior, especially when self-hosting LiveKit.

Run one app replica; live rooms, private calls and call availability are in memory. Redeploying closes active rooms and calls and takes hosts offline for calls. Capacity is currently 50 viewers per broadcast room and is also subject to the LiveKit project quota. Nothing upgrades a paid plan automatically.

## Privacy and capture limits

Recording and screenshots are prohibited by the room rules. This app has no capture or storage path for video/audio and grants no room recording permission to participants. The `display-capture` Permissions Policy prevents this page from invoking screen sharing where supported; it does **not** stop a device or another application from recording this page.

Browser apps cannot guarantee screenshot or screen recording prevention. Watermarks, removal and reporting deter misuse; they are not technical capture prevention. No automatic capture detection or screenshot notification is claimed.

A future native Android client can use `FLAG_SECURE`; a future iOS client can react to OS capture state and pause media, but screenshot notifications arrive after the screenshot. Even native protection cannot prevent another camera filming a screen. Those native protections are not implemented in this web build.

## Validation and remaining work

`npm test` verifies real HTTP/WebSocket clients with a fake media adapter, plus signed LiveKit token permissions, room membership, privacy consent, report access, moderation and logout. The fake adapter is test-only and is never selected by environment configuration.

`scripts/browser-smoke.mjs` exercises broadcasts, a guest host, test gift battle and private calls against a real local LiveKit server with synthetic camera/microphone devices (requires Playwright/Chromium). `bash scripts/media-ci.sh` downloads the pinned server, verifies its checksum and runs that check. It does not record media or screenshot live streams. See `VALIDATION.md` for the exact tested scope.

This is a working tester, not a finished public app. A home-screen web install is not a native iOS/Android binary. Remaining: physical-device and carrier-network verification; provider setup for Facebook and general email delivery; native distribution and capture protections; real payments, coin purchases, settlement and payouts; durable multi-instance presence and call recovery; production abuse controls and operational backups. Gifts and calls use test-only credits or no billing. There is no simulated money or fake live activity.

## Account provider setup (Veya only)

Google and Facebook are implemented but hidden until their Veya credentials are configured. Existing email accounts remain usable. A social identity is never linked just because its email matches: sign in to the existing account and use Account settings to connect the provider. New social accounts must explicitly acknowledge being 18+. This is acknowledgement, not age verification.

Google: create a Web application OAuth client in a separate Veya Google Cloud project, with `openid email profile` scopes. Authorized redirect URI: `https://veya-backend-development.up.railway.app/auth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` privately in the Veya Railway service. Configure consent-screen audience/test users before external use.

Facebook: create a separate Veya Meta developer app with Facebook Login. Redirect URI: `https://veya-backend-development.up.railway.app/auth/facebook/callback`. Set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and the supported `FACEBOOK_API_VERSION` shown in your app dashboard. Request only public profile and email. Meta's app-mode, permission, privacy-policy and deletion requirements must be completed before opening it to everyone. No tokens are stored or exposed to the frontend.

Email: set separate `RESEND_API_KEY` and `EMAIL_FROM` values using a verified Veya sender. Delivery is not active until configured. Resend's test sender can only send to the account owner's address; general delivery needs a verified sender domain, which has not been purchased or configured. Do not use TLOU's account, keys, or domain. Once email delivery is enabled, unverified accounts cannot enter live rooms. Google-verified email is accepted; Facebook email is not automatically treated as verified. Existing email accounts also need to verify.

Verification and reset links have one-use hashed tokens, expire after 60/30 minutes, and reset revokes all sessions. Link tokens are in the URL fragment and cleared before further navigation. Send requests return the same message for unknown accounts. Delivery has a per-address cooldown and 100-request daily guard per running instance; this is not a provider billing cap. Provider callbacks use browser-bound, one-use state, with PKCE and nonce validation for Google.

Status: automated security and local browser checks cover code behavior. Google sign-in and host publishing have been confirmed by the owner on the hosted Veya build. Facebook and email delivery still require configuration and live checks. SMS and WhatsApp verification are not enabled.

## Profile setup and Explore

New and existing accounts without a completed profile enter a two-step setup: display name, optional photo/bio, explicit 18+ acknowledgement when needed, then optional interests. Profiles persist in the existing SQLite volume. Client photos are cropped and re-encoded to 256px JPEG; the API caps the request and permits only raster JPG/PNG data with matching signatures. No SVG or remote photo URL is accepted. Editing is authenticated, origin checked and blocked while that account has a live room.

Explore separates real live rooms, approved hosts and people, with title, host and country search. Host cards show live state or current call availability only when the host has opted in on an open app session. Empty states contain no fabricated activity. My profile contains editing, account connections and sign-out; Go live requires a room title and has its own setup screen. Room privacy, moderation and media permissions are retained.

Live gifts use an isolated test-credit ledger. Each approved member starts with 250 free test credits and can send one of 51 gifts to another current room participant. Sending requires confirmation; a successful gift briefly animates in the camera view of everyone in the room and appears in room chat. Balance and illustrated history appear in Profile; hosts see test gifts received in their host hub; moderators can inspect the latest transactions. Transfers are atomic and idempotent. Test credits and gifts have no monetary value, purchase flow, conversion or payout. The assets and lightweight player are self-hosted; attribution and licenses are in `GIFT_CREDITS.md` and the gift picker. The original four Veya SVGs and text icons provide fallbacks if animation loading fails.

Gift admins can add free test credits to an existing account from the Gift studio. Each grant has a required reason and audit row, with a per-grant and wallet cap. Grants increase only test balance; they do not change earned or received gift totals.

## Tester and host access

All accounts select a country/region from Unicode CLDR territory data. Country is self-reported and appears only in the account's own setup and admin management. Newly created and existing accounts are viewers by default; testing access requires explicit approval, and streaming requires separate host approval. Owner IDs are configured privately using `ADMIN_USER_IDS`; owner status is never granted to the first signup or inferred from an unverified email. Until an owner is configured, accounts can sign in and complete profiles but cannot enter rooms. The account ID appears in My profile to support secure owner setup.

Admin management supports tester approvals, optional-field host applications, manual external auditions, trials and host decisions. Trial review cards show recorded current-week qualifying hours, actual hours, live days and configured targets beside the decision. New hosts must start a trial. Defaults are 15 days and pause for review at expiry; these are editable. Trial duration changes apply to new/extended trials, while expiry outcome uses the current setting. Paid trial amount, required hours/days and daily cap are planning settings only: no coin purchases, gift transfers, eligibility calculations or withdrawals are enabled. Live sessions track connected host time from media readiness through end/heartbeat; this is not yet a payout calculation.

Owner grants separate testers/hosts/moderation/settings/appeals permissions. Every management mutation is audited. Account/phone/IP suspensions support expiry and grouped lifting, and close affected room connections. Phone is optional and unverified; phone blocking cannot establish identity or stop a user signing up without that number. IP blocking uses Railway's documented edge-injected `X-Real-IP` only in a Railway environment and does not trust arbitrary forwarded headers locally. IP and phone blocks also block the selected account; shared IP addresses may affect other users. Suspended accounts can sign in to submit in-app appeals; admins reply and mark reviewed. WhatsApp contact integration is pending a contact number.
