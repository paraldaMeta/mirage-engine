// Writes the two sound files of the audio demo, fx/chime.wav (decoded into memory) and fx/theme.wav (streamed), from
// the code in sounds.js. They are committed so the demo has real files to load; run this again to rebuild them.
// node examples/demos/audio/make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav } from '@mirage/game/audio-dsp';
import { chime, theme } from './sounds.js';

const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fx');
fs.mkdirSync(fx, { recursive: true });
const write = (name, data, sr) => { const b = Buffer.from(encodeWav([data], sr, 16)); fs.writeFileSync(path.join(fx, name), b); console.log(`${name}: ${(data.length / sr).toFixed(2)} s, ${sr} Hz, ${(b.length / 1024).toFixed(0)} KB`); };
write('chime.wav', chime(660, 0.9, 24000), 24000);
write('theme.wav', theme({ bpm: 100, bars: 4, sr: 16000 }), 16000);
