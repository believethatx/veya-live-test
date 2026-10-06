# Validation — 6 October 2026

Passed:
- `npm run build`: bundled the official LiveKit client for self-hosted browser delivery.
- `npm test`: 7 tests; accounts/sessions, signed media permission grants, multiple viewer membership, consent enforcement, durable reports, access controls, host removal, moderation, logout and room cleanup.
- `node scripts/ui-smoke.mjs`: real Chromium, 390-pixel mobile and 1280-pixel desktop, registration/login/logout, no horizontal overflow, and honest disabled-streaming state when media is unconfigured.
- `bash scripts/media-ci.sh` on GitHub Actions: official LiveKit server 1.13.8 with a verified release checksum; synthetic camera/microphone; one real host and two real browser viewers; decoded video frames, live chat, mobile room layout, reports, host removal and room cleanup. No video recording or live screenshots.
- Full pipeline passed for commit `7292a50b7528362aed7c321f826cabebbe010d02`: https://github.com/believethatx/veya-live-test/actions/runs/37524331479
- The public GitHub Pages URL now serves the development notice rather than simulated live rooms.

Not verified:
- Real phones and cross-network connections. The full media test passed on GitHub’s runner; the local execution environment cannot start LiveKit because it disallows a required network interface operation. The passing test uses browser clients on one runner, not two physical phones or mobile carrier networks.
- Public app hosting, persistent-volume backups and LiveKit Cloud configuration. No Veya backend host or LiveKit project is connected. No spending or provider upgrade has been initiated.
- Native device screenshot/recording prevention. This is a browser client and cannot provide that protection.

A scoped fake media adapter is used only by backend automated tests. It does not prove streaming works. The browser UI test uses the normal application with unconfigured media and verifies that no fake live content appears.
