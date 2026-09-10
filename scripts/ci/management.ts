// Management analysis — legal / regulatory / criminal risk per stock.
//
// For every stock: pulls the company officers from Yahoo quoteSummary, then
// mines Google News RSS for litigation signals (criminal / civil / regulatory)
// against the company / founder / management. Scores management quality and
// appends a `management` block to each entry in `frontend/public/analysis.json`
// (written by fundamentals.ts). Reruns idle-safe: if Yahoo or the news bank is
// unreachable it leaves existing analysis untouched and exits clean.
//
// Symbol coverage follows the fundamentals coverage (SEED + every symbol
// already in `analysis.json`), so the nightly analysis batch automatically
// widens the management net too (a stock like DLF added via the coverage batch
// used to stay empty because only SEED was scanned).
//
// Env knobs:
//   MANAGEMENT_MAX  cap on how many symbols are scanned this run (defaults to
//                   the whole covered set, up to 400)

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INSTRUMENTS as SEED } from '../../services/shared/src/instruments-data.js';

const ANALYSIS_FILE = join(process.cwd(), 'frontend', 'public', 'analysis.json');
const KEEP_DAYS = 45;
const PER_STOCK_CASES = 10;
const POOL_SIZE = 6;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

interface LegalCase {
  kind: 'criminal' | 'civil' | 'regulatory' | 'other';
  title: string;
  source: string;
  url: string;
  date: string | null;
}

interface MgmtAnalysis {
  score: number;
  grade: string;
  thesis: string;
  founders: { name: string; role: string }[];
  checks: { key: string; label: string; severity: 'good' | 'warn' | 'bad' }[];
  cases: LegalCase[];
  updatedAt: string;
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function quoteSummaryOfficers(symbol: string): Promise<{ name: string; role: string }[]> {
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    const cookies = (cookieRes.headers.get('set-cookie') ?? '')
      .split(/,(?=\s*\w+=\w)/)
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean);
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookies.join('; ') },
      signal: AbortSignal.timeout(10_000),
    });
    if (!crumbRes.ok) return [];
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64) return [];
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=summaryProfile&crumb=${encodeURIComponent(crumb)}&formatted=false`,
      { headers: { 'User-Agent': UA, Cookie: cookies.join('; ') }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Record<string, any>;
    const officers = body?.quoteSummary?.result?.[0]?.summaryProfile?.companyOfficers;
    if (!Array.isArray(officers)) return [];
    return officers
      .slice(0, 5)
      .map((o: any) => ({
        name: String(o.name ?? ''),
        role: String(o.title ?? o.role ?? ''),
      }))
      .filter((o: { name: string }) => o.name);
  } catch {
    return [];
  }
}

function classify(title: string): LegalCase['kind'] {
  const t = title.toLowerCase();
  if (
    /criminal|cbi|ed (raids?|srev|summon)|fraud|scam|arrest|first information report|\bfir\b|police|pmla|money laundering|prosecut|convict|chargesheet|cheating|embezzle|insider trading|mfin case|economic offence|look-out circular/.test(t)
  ) return 'criminal';
  if (
    /sebi|rbi|regulator|penalty|barred|banned?|adjudicat|restraint order|court ordered|show-cause|notice|warning|interim order|market regulator|suspension|don'?t breach/g.test(t)
  ) return 'regulatory';
  if (
    /lawsuit|suit|civil|complaint|petition|\bplea\b|writ|consumer court|ncl?t|arbitration|legal battle|legal row|case (against|filed)|probe into/.test(t)
  ) return 'civil';
  return 'other';
}

function significantTokens(name: string, symbol: string): string[] {
  const tokens = name
    .replace(/[^A-Za-z0-9&. -]/g, '')
    .split(/[\s.]+/)
    .filter((t) => t.length > 2 && !/^(ltd|limited|the|co|corporation|corp|group|industries|holding|bse|nse|share|bonds)$/i.test(t));
  if (symbol.length >= 2) tokens.unshift(symbol);
  return [...new Set(tokens)];
}

async function newsCases(symbol: string, name: string): Promise<{ ok: boolean; cases: LegalCase[] }> {
  const tokens = significantTokens(name, symbol);
  const queries = [
    `"${name}" (fraud OR scam OR criminal OR arrest OR FIR OR CBI OR ED OR PMLA OR money launder)`,
    `"${name}" SEBI (penalty OR ban OR barred OR order OR investigation)`,
    `"${name}" (lawsuit OR case OR court OR NCLT OR petition OR plea)`,
  ];
  const map = new Map<string, LegalCase>();
  const relevance = /(fraud|scam|arrest|fir|cbi|ed raids|money launder|criminal|prosecut|chargesheet|convict|sebi|penalty|barred|ban on|adjudicat|show cause|restraint|lawsuit|\bcourt\b|nclt|petition|\bplea\b|civil suit|complaint|probe|investigation|raids)/i;
  let ok = false;
  for (const q of queries) {
    const xml = await fetchText(
      'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-IN&gl=IN&ceid=IN:en',
    );
    if (!xml) continue;
    ok = true;
    for (const it of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const titleM = it.match(/<title>([\s\S]*?)<\/title>/);
      const linkM = it.match(/<link>([\s\S]*?)<\/link>/);
      const dateM = it.match(/<pubDate>([^<]*?)<\/pubDate>/);
      const srcM = it.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (!titleM || !linkM) continue;
      const title = titleM[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      const low = title.toLowerCase();
      // skip economy-wide filler that doesn't name the company
      if (!tokens.some((tok) => low.includes(tok.toLowerCase()))) continue;
      if (!relevance.test(low)) continue;
      const key = low.replace(/[^a-z0-9]/g, '').slice(0, 70);
      const kind = classify(title);
      const date = dateM ? new Date(dateM[1]).toISOString() : null;
      if (date && new Date(date).getTime() < Date.now() - KEEP_DAYS * 86_400_000) continue;
      if (!map.has(key)) {
        map.set(key, {
          kind,
          title: title.replace(/^Top Stories\s*/, ''),
          source: srcM ? srcM[1].replace(/<[^>]+>/g, '').trim() : 'Google News',
          url: linkM[1].trim(),
          date,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok, cases: [...map.values()].slice(0, PER_STOCK_CASES) };
}

function gradeFor(score: number): string {
  if (score >= 80) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 50) return 'B';
  if (score >= 40) return 'B-';
  if (score >= 30) return 'C+';
  return 'C';
}

function analyze(details: {
  founders: { name: string; role: string }[];
  cases: LegalCase[];
  promoterHolding: number | null;
}): MgmtAnalysis {
  const checks: MgmtAnalysis['checks'] = [];
  const cases = details.cases;
  const criminal = cases.filter((c) => c.kind === 'criminal');
  const regulatory = cases.filter((c) => c.kind === 'regulatory');
  const civil = cases.filter((c) => c.kind === 'civil');

  let score = 72;
  if (criminal.length === 0 && regulatory.length === 0 && civil.length === 0) {
    score += 12;
    checks.push({ key: 'no-litigation', label: 'No criminal/civil/regulatory action found in public news (45-day window)', severity: 'good' });
  }
  if (criminal.length) {
    score -= Math.min(60, criminal.length * 25);
    checks.push({ key: 'criminal', label: `${criminal.length} criminal-flagged headline(s) in public news`, severity: 'bad' });
  }
  if (regulatory.length) {
    score -= Math.min(40, regulatory.length * 14);
    checks.push({ key: 'regulatory', label: `${regulatory.length} regulatory action headline(s) (SEBI/regulator mention)`, severity: 'warn' });
  }
  if (civil.length) {
    score -= Math.min(24, civil.length * 8);
    checks.push({ key: 'civil', label: `${civil.length} civil/court headline(s)`, severity: 'warn' });
  }
  const ph = details.promoterHolding;
  if (ph != null) {
    if (ph >= 50) {
      score += 6;
      checks.push({ key: 'promoter', label: `Promoter holding ${ph}% — majority skin in the game`, severity: 'good' });
    } else if (ph < 25) {
      score -= 6;
      checks.push({ key: 'promoter', label: `Promoter holding just ${ph}% — weak insider alignment`, severity: 'warn' });
    } else {
      checks.push({ key: 'promoter', label: `Promoter holding ${ph}%`, severity: 'good' });
    }
  }
  const dirTrust = details.founders.some((f) => /(chairman|managing director|chief executive|founder|promoter|chair)/i.test(f.role));
  if (dirTrust) checks.push({ key: 'founders', label: `Officers on record: ${details.founders.slice(0, 3).map((f) => `${f.name} (${f.role.split(',').pop() || f.role})`).join(', ')}`, severity: 'good' });

  score = Math.max(0, Math.min(100, Math.round(score)));
  const thesis =
    score >= 70
      ? 'Management appears clean: no material litigation in public news, aligned promoter holdings.'
      : score >= 45
        ? 'Management flagged in public reporting — review the listed cases before sizing a position.'
        : 'Serious concern: repeated criminal/regulatory headlines against the company or management.';
  return {
    score,
    grade: gradeFor(score),
    thesis,
    founders: details.founders,
    checks,
    cases,
    updatedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  let analysis: Record<string, any>;
  try {
    analysis = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf8'));
  } catch {
    console.error('management: analysis.json missing — run fundamentals.ts first');
    process.exitCode = 1;
    return;
  }
  const stocks = analysis.stocks as Record<string, any>;
  if (!stocks) {
    console.error('management: analysis.json has no stocks');
    process.exitCode = 1;
    return;
  }

  // ---- symbol universe: SEED + every symbol the analyst model covers ------
  // (matches news.ts) so coverage-batch additions — DLF, etc. — no longer stay
  // empty just because they aren't in the hard-coded seed list.
  const wanted = new Map<string, string>(); // symbol -> name
  for (const s of SEED) wanted.set(s.symbol, s.name);
  for (const [sym, e] of Object.entries(stocks)) {
    if (!sym || wanted.has(sym)) continue;
    wanted.set(sym, typeof e?.name === 'string' ? e.name : sym);
  }
  const max = Number(process.env.MANAGEMENT_MAX ?? (wanted.size > 400 ? 400 : wanted.size));

  const tasks: { sym: string; entry: any }[] = [];
  for (const sym of [...wanted.keys()].slice(0, max)) {
    const entry = stocks[sym];
    if (entry !== undefined) tasks.push({ sym, entry });
  }

  let cursor = 0;
  let scored = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= tasks.length) return;
      const { sym, entry } = tasks[idx];
      const name = entry.name ?? sym;
      // keep previous data on transient failures
      const previous = entry.management as MgmtAnalysis | undefined;

      let founders: MgmtAnalysis['founders'] = previous?.founders ?? [];
      try {
        const fresh = await quoteSummaryOfficers(`${sym}.NS`);
        if (fresh.length) founders = fresh;
      } catch {
        // keep previous
      }

      let cases: LegalCase[] = previous?.cases ?? [];
      let newsOk = false;
      try {
        const fresh = await newsCases(sym, name);
        newsOk = fresh.ok;
        if (fresh.cases.length) cases = fresh.cases;
      } catch {
        // keep previous
      }

      const ph = entry.metrics?.promoterHolding ?? null;
      // If neither news nor officers could be reached AND there is nothing to
      // carry forward, skip — don't fabricate a clean-sheet block that would
      // look like a real "no litigation" verdict.
      const noData = !newsOk && founders.length === 0 && cases.length === 0 && previous == null;
      if (!noData) {
        const mgmt =
          previous && cases.length === 0 && founders.length === 0
            ? previous
            : analyze({ founders, cases, promoterHolding: ph });
        entry.management = mgmt;
        scored += 1;
        console.log(`management: ${sym} -> ${mgmt.grade} (${mgmt.score}/100, ${mgmt.cases.length} cases flagged)`);
      } else {
        console.log(`management: ${sym} -> skipped (no data sources reachable)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL_SIZE, tasks.length) }, worker));

  writeFileSync(ANALYSIS_FILE, JSON.stringify(analysis));
  console.log(`management: ${scored}/${tasks.length} stocks scored (cap=${max})`);
}

main().catch((e) => {
  console.error('management failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});