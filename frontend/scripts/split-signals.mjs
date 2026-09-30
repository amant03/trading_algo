// Split the monolithic signals.json into one small file per symbol.
// The stock page used to JSON.parse the whole ~11MB file in the browser,
// which froze and crashed tabs. Each file is the last 40 signals only.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public', 'signals.json');
const outDir = join(root, 'public', 'sig');

const raw = JSON.parse(readFileSync(src, 'utf8'));
const data = raw?.data && typeof raw.data === 'object' ? raw.data : {};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let n = 0;
let bytes = 0;
let max = 0;
for (const [sym, sigs] of Object.entries(data)) {
  if (!Array.isArray(sigs) || sigs.length === 0) continue;
  const body = JSON.stringify({ symbol: sym, signals: sigs.slice(0, 40) });
  writeFileSync(join(outDir, `${encodeURIComponent(sym)}.json`), body);
  n += 1;
  bytes += body.length;
  if (body.length > max) max = body.length;
}

if (!n) {
  console.error('split-signals: signals.json had no per-symbol data');
  process.exit(1);
}

console.log(
  `split-signals: ${n} symbols, ${(bytes / 1024 / 1024).toFixed(2)} MB total, largest ${(max / 1024).toFixed(1)} KB`,
);
