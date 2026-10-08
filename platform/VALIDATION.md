# Validation — 8 October 2026

Local checks passed on the `figgy-inspired` worktree:

- `npm test`: 44 tests covering account and OAuth boundaries, tester/host gates, profiles, follows, Moment replies, report deduplication and deletion, messages, gifts, rankings, guest invitation, audience-only battle scoring and saved history, guest activity hours, room membership, moderation, and private call authorization/expiry.
- `node scripts/profile-social-smoke.mjs`: two mobile accounts posting a photo Moment, liking, replying and reporting, following, notification, profile links and connection lists.
- `node scripts/admin-smoke.mjs`: mobile and desktop admin sections, tester approval, host trials, profile edit/lock, settings, appeals and moderator review/removal of a reported Moment.
- `npm run build` and `node scripts/ui-smoke.mjs`: mobile and desktop signup, profile setup/edit, navigation, discovery, and no horizontal overflow.
- `node scripts/call-ui-smoke.mjs`: two independent mobile browser sessions, host opt-in, viewer invitation, host acceptance, and hangup.
- `node scripts/pwa-smoke.mjs`: install manifest and icons, public offline fallback when the app server is unavailable, recovery when it returns, and an offline cache containing no private account/API data.
- `bash scripts/media-ci.sh`: official pinned LiveKit server 1.13.8, checksum verified, synthetic camera/microphone, host broadcasting to two viewers, approved guest camera video received by host and viewer, confirmed test gift battle scoring, guest leaving and host removal, room chat/gifts/moderation, then a separate private call with decoded remote video on **both** sides. No live screenshots or recording were made.

Still requires real-world verification: two physical phones on different networks, camera/microphone permission behavior on iOS and Android browsers, LiveKit Cloud quotas, and long-running service resilience. The private call registry and host availability are in memory; a restart ends calls and takes hosts offline. This is a test-credit build without purchase, settlement, or payout functions. Browser software cannot guarantee prevention of device screenshots or external recording.
