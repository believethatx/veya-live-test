# Validation — 6 October 2026

Passed:
- `npm run build`: bundled the official LiveKit client for self-hosted browser delivery.
- `npm test`: 7 tests; accounts/sessions, signed media permission grants, multiple viewer membership, consent enforcement, durable reports, access controls, host removal, moderation, logout and room cleanup.
- `node scripts/ui-smoke.mjs`: real Chromium, 390-pixel mobile and 1280-pixel desktop, registration/login/logout, no horizontal overflow, and honest disabled-streaming state when media is unconfigured.

Not verified:
- `scripts/browser-smoke.mjs` against real media. Downloaded official LiveKit server 1.13.8, but its startup fails in this execution environment with `route ip+net: netlinkrib: operation not permitted`. No full-media test passed, and no real-phone or cross-network test has been performed.
- Public app hosting, persistent-volume backups and LiveKit Cloud configuration. No Veya backend host or LiveKit project is connected. No spending or provider upgrade has been initiated.
- Native device screenshot/recording prevention. This is a browser client and cannot provide that protection.

A scoped fake media adapter is used only by backend automated tests. It does not prove streaming works. The browser UI test uses the normal application with unconfigured media and verifies that no fake live content appears.
