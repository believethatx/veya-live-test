import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
await build({ stdin: { contents: "export { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client';", resolveDir: process.cwd(), sourcefile: 'livekit-entry.js' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/livekit.js', minify: true, legalComments: 'eof' });

await build({ stdin: { contents: "export { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';", resolveDir: process.cwd(), sourcefile: 'face-entry.js' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/face.js', minify: true, legalComments: 'eof' });

const wasmSource = 'node_modules/@mediapipe/tasks-vision/wasm';
const wasmDestination = 'public/face-wasm';
await mkdir(wasmDestination, { recursive: true });
for (const variant of ['vision_wasm_internal', 'vision_wasm_nosimd_internal']) {
  await copyFile(`${wasmSource}/${variant}.js`, `${wasmDestination}/${variant}.js`);
  const binary = await readFile(`${wasmSource}/${variant}.wasm`);
  await writeFile(`${wasmDestination}/${variant}.wasm.gz`, gzipSync(binary, { level: 9 }));
}
const modelFile = 'public/face_landmarker.task';
const expectedHash = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
let model;
try { model = await readFile(modelFile); } catch {}
if (!model || createHash('sha256').update(model).digest('hex') !== expectedHash) {
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task');
  if (!response.ok) throw Error(`Face model download failed: ${response.status}`);
  model = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(model).digest('hex') !== expectedHash) throw Error('Face model checksum changed');
  await writeFile(modelFile, model);
}
