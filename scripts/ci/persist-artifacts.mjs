// Merge remote automation-data artifacts into the local run's output before
// committing. The automation branch is force-pushed (last-writer-wins) so any
// commit that lands between this run's pre-stage and its commit step — most
// importantly a user-triggered `Import Symbol` — would otherwise be orphaned.
//
// This unions them in instead:
//   * analysis.json — remote entries we don't have are carried in (never drop
//     a freshly imported symbol), ours win on a symbol conflict.
//   * news.json — every symbol's item list is merged (ours wins per title).
//   * signals.json — remote symbols we don't have are carried in (a run with
//     partial Yahoo failures never drops a symbol a previous run had).
//   * snapshot.json / paper/* / reports/* — local (generated this run) wins.
//
// Reads the branch via raw.githubusercontent.com (public repo, no auth). No deps.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const REPO = 'amant03/trading_algo';
const BRANCH = 'automation-data';
const PUBLIC = join(process.cwd(), 'frontend', 'public');

function readJson(rel) {
  const p = join(PUBLIC, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchRemote(rel) {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/frontend/public/${rel}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.startsWith('{') || text.startsWith('[') ? text : null;
  } catch {
    return null;
  }
}

async function unionAnalysis() {
  const local = readJson('analysis.json');
  const remoteRaw = await fetchRemote('analysis.json');
  if (!local) return;
  if (!remoteRaw) return;
  let remote;
  try {
    remote = JSON.parse(remoteRaw);
  } catch {
    return;
  }
  if (!remote?.stocks) return;
  const stocks = local.stocks ?? {};
  let added = 0;
  for (const [sym, entry] of Object.entries(remote.stocks)) {
    if (!(sym in stocks)) {
      stocks[sym] = entry;
      added += 1;
    }
  }
  const count = Object.keys(stocks).length;
  local.stocks = stocks;
  local.universe = count;
  local.carried = count - (local.seed ?? 0) - (local.batch ?? 0);
  writeFileSync(join(PUBLIC, 'analysis.json'), JSON.stringify(local));
  console.log(`merge-artifacts: analysis union +${added} remote symbols -> ${count} total`);
}

async function unionNews() {
  const local = readJson('news.json');
  const remoteRaw = await fetchRemote('news.json');
  if (!local) return;
  if (!remoteRaw) return;
  let remote;
  try {
    remote = JSON.parse(remoteRaw);
  } catch {
    return;
  }
  if (!remote?.items) return;
  const items = local.items ?? {};
  let added = 0;
  for (const [sym, list] of Object.entries(remote.items)) {
    if (!(sym in items)) {
      items[sym] = list;
      added += 1;
    }
  }
  local.items = items;
  local.symbols = Object.keys(items).length;
  writeFileSync(join(PUBLIC, 'news.json'), JSON.stringify(local));
  console.log(`merge-artifacts: news union +${added} remote symbols -> ${local.symbols} total`);
}

async function unionSignals() {
  const local = readJson('signals.json');
  const remoteRaw = await fetchRemote('signals.json');
  if (!local) return;
  if (!remoteRaw) return;
  let remote;
  try {
    remote = JSON.parse(remoteRaw);
  } catch {
    return;
  }
  if (!remote?.data) return;
  const data = local.data ?? {};
  let addedSyms = 0;
  let addedSigs = 0;
  for (const [sym, list] of Object.entries(remote.data)) {
    if (!(sym in data)) {
      data[sym] = list;
      addedSyms += 1;
      addedSigs += Array.isArray(list) ? list.length : 0;
    }
  }
  local.data = data;
  local.symbols = Object.keys(data).length;
  local.totalSignals = Object.values(data).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
  writeFileSync(join(PUBLIC, 'signals.json'), JSON.stringify(local));
  console.log(`merge-artifacts: signals union +${addedSyms} remote symbols (+${addedSigs} signals) -> ${local.symbols} total`);
}

async function main() {
  await unionAnalysis();
  await unionNews();
  await unionSignals();
  // sanity: refresh any gating artifact that was only present upstream
  for (const rel of ['snapshot.json', 'paper/latest.json', 'paper/state.json', 'paper/daily.json', 'signals.json']) {
    if (!existsSync(join(PUBLIC, rel))) {
      const remote = await fetchRemote(rel);
      if (remote) {
        writeFileSync(join(PUBLIC, rel), remote);
        console.log(`merge-artifacts: seeded missing ${rel} from automation-data`);
      }
    }
  }
  // keep git porcelain quiet if we wrote files (avoids CRLF warnings on Windows)
  execSync('git add frontend/public 2>/dev/null || true', { stdio: 'ignore' });
}

main().catch((e) => {
  console.error('merge-artifacts failed (continuing):', e instanceof Error ? e.message : e);
  process.exitCode = 0;
});