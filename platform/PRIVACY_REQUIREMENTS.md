# Stream privacy requirements — 6 October 2026

The owner requires screenshots and stream recordings to be prohibited. Treat this as a platform rule throughout accounts, room entry and moderation.

Implemented in the web application: entry acknowledgement, no recording or screenshot feature, no media upload/storage, no recording grant, no screen share grant, identifiable per-viewer watermark, host viewer removal, text reports with the room snapshot and owner moderation. Do not display any claim that screenshots or external recording are technically blocked.

Native Android implementation must use FLAG_SECURE on protected live screens and verify audio capture policy separately. Native iOS implementation must respond to the supported scene capture API by stopping playback/audio and obscuring content when capturing is active. A screenshot notification cannot undo a screenshot and must never be presented as prevention. Check the applicable platform APIs at implementation time.

Require device tests before making native capture-protection claims. No platform can prevent someone filming a screen with another camera.
