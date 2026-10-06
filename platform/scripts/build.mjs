import { build } from 'esbuild';
await build({ stdin: { contents: "export { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client';", resolveDir: process.cwd(), sourcefile: 'livekit-entry.js' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/livekit.js', minify: true, legalComments: 'eof' });
