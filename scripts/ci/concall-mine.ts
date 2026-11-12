// Extractive read of a concall transcript, annual-report passage, or rating
// rationale. Every line kept here is a sentence from the filing. Nothing is
// invented, and journalist questions are dropped so the SWOT is what
// management said.

export type Tone = 'confident' | 'cautious' | 'mixed';

export interface Swot {
  willDo: string[];
  willEndure: string[];
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface MinedProse {
  eventDate: string | null;
  summary: string;
  highlights: string[];
  swot: Swot;
  tone: Tone;
}

export interface PxBar {
  day: string;
  c: number;
}

export interface PriceMove {
  return1d: number | null;
  return5d: number | null;
  excess1d: number | null;
  excess5d: number | null;
  sessions: number;
  priceBefore: number | null;
  priceAfter: number | null;
}

export interface NewsHit {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  overlap: string;
  aroundFiling: boolean;
}

export interface DocLink {
  url: string;
  label: string;
  date: string | null;
}

const MONTHS: Record<string, string> = {
  january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
  april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09', october: '10',
  oct: '10', november: '11', nov: '11', december: '12', dec: '12',
};

const GENERIC = new Set([
  'revenue', 'growth', 'margin', 'quarter', 'operating', 'company', 'business',
  'market', 'india', 'limited', 'year', 'percent', 'results', 'financial',
  'management', 'board', 'call', 'earnings', 'stock', 'share', 'price',
  'today', 'also', 'will', 'have', 'from', 'that', 'this', 'with', 'their',
  'about', 'after', 'which', 'there', 'been', 'were', 'said', 'says',
  'first', 'street', 'analyst', 'shares', 'nifty', 'stock', 'september',
  'october', 'november', 'december', 'january', 'february', 'march', 'april',
  'august', 'pharma', 'bank', 'limited',
]);

export function emptySwot(): Swot {
  return { willDo: [], willEndure: [], strengths: [], weaknesses: [], opportunities: [], threats: [] };
}

export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

function toIso(monthName: string, day: string, year: string): string | null {
  const mo = MONTHS[monthName.toLowerCase()];
  if (!mo) return null;
  const d = Number(day);
  const y = Number(year);
  if (!d || d > 31 || y < 1990 || y > 2100) return null;
  return `${year}-${mo}-${String(d).padStart(2, '0')}`;
}

export function parseLongDate(s: string): string | null {
  const m = s.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!m) return null;
  return toIso(m[1], m[2], m[3]);
}

/** "26 Jun 2025" or "26 Jun" (year inferred so the date is not in the future). */
export function parseLooseDate(s: string, today = new Date()): string | null {
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const withYear = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (withYear) return toIso(withYear[2], withYear[1], withYear[3]);
  const noYear = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\b/);
  if (!noYear) return null;
  const todayIso = today.toISOString().slice(0, 10);
  let year = today.getUTCFullYear();
  let isoDay = toIso(noYear[2], noYear[1], String(year));
  if (isoDay && isoDay > todayIso) isoDay = toIso(noYear[2], noYear[1], String(year - 1));
  return isoDay;
}

function isSpeaker(line: string): boolean {
  if (line.length < 3 || line.length > 42) return false;
  if (/[0-9?]/.test(line)) return false;
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z.]*){0,3}$/.test(line);
}

export function reflow(raw: string): string {
  const cleaned = raw
    .replace(/YoY\.(?=[a-z])/g, 'YoY. ')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/\r/g, '')
    .replace(/External Document[^\n]*/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l) && !/^page \d+/i.test(l));
  const out: string[] = [];
  for (const line of lines) {
    if (!out.length || isSpeaker(line)) {
      out.push(line);
      continue;
    }
    const prev = out[out.length - 1];
    if (isSpeaker(prev) || (/[.!?:]$/.test(prev) && /^[A-Z("]/.test(line))) {
      out.push(line);
      continue;
    }
    out[out.length - 1] = `${prev} ${line}`;
  }
  return out.join('\n');
}

function isQuestion(s: string): boolean {
  if (s.includes('?')) return true;
  return /^(could you|can you|would you|what |why |how |when |where |is there|do you|does the|have you|my |please |thanks|thank you|good (morning|evening|afternoon)|operator\b|over to you|i am going to hand)/i.test(s);
}

function isBoilerplate(s: string): boolean {
  return /phone\s*#|\bcin\b|investor\.relations@|jeejeebhoy|nariman point|dalal street|national stock exchange|bombay stock exchange|bse limited|dear sir|yours (sincerely|faithfully)|company secretary|membership no|registered office|this is for your information|does not discuss|do not discuss|refer to annexure|1 crore =|concluded at|transcript of the|maker chambers|boulevard/i.test(s);
}

function substance(s: string): number {
  let n = 0;
  if (/\d/.test(s)) n += 2;
  if (/%|\$|₹|\bbn\b|\bcrore\b|\bbps\b/i.test(s)) n += 2;
  if (/guidan|outlook|margin|headwind|capex|pipeline|order book|demand|pricing|wage|attrition|volume|cash flow|dividend|deal/i.test(s)) n += 3;
  if (/\b(we will|we expect|we plan|we aim|we guide|guidance)\b/i.test(s)) n += 2;
  if (s.length > 240) n -= 1;
  return n;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((block) => (isSpeaker(block) ? [] : block.split(/(?<=[.!])\s+(?=[A-Z])/)))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 36 && s.length <= 420 && !isQuestion(s) && !isBoilerplate(s) && !/editor.?s comment|\[inaudible\]|crosstalk/i.test(s));
}

function bucketOf(s: string): keyof Swot | null {
  const l = s.toLowerCase();
  const pressure = /headwind|wage|compensation|pricing intensity|cost inflation|raw material|input cost/.test(l);
  const response = /offset|mitigat|absorb|manage|working on|we will|continue|project /.test(l);
  if (pressure && response) return 'willEndure';
  if (/guidance (is|remains|of|for|at)\b|\bwe (will|plan|aim|expect|intend)\b|\bcapex\b|commissioning|order book|we are expanding/.test(l)) return 'willDo';
  if (/uncertain|slowdown|geopolitic|tariff|macro|weak demand|pricing intensity|headwind|intensifying competition/.test(l)) return 'threats';
  if (/softer|declin|muted|downward|lower than|narrowed|delay|missed|weaker/.test(l)) return 'weaknesses';
  if (/opportunit|pipeline|mega deal|new market|expansion|ai revenue|export order/.test(l)) return 'opportunities';
  if (/record|strong|healthy|stable at|robust|standout|improved|highest|free cash/.test(l)) return 'strengths';
  return null;
}

function toneOf(lines: string[]): Tone {
  const blob = lines.join(' ').toLowerCase();
  const cautious = (blob.match(/softer|downward|headwind|uncertain|weaker|decline|muted|cut /g) ?? []).length;
  const confident = (blob.match(/record|strong|healthy|raise|upgrade|highest|robust|standout/g) ?? []).length;
  if (cautious >= 2 && confident >= 2) return 'mixed';
  if (cautious > confident) return 'cautious';
  if (confident > cautious) return 'confident';
  return 'mixed';
}

export function eventDateFromText(text: string): string | null {
  const head = text.slice(0, 3500);
  const pref = head.match(/(?:held on|directors on|meeting on)\s+([A-Za-z]+ \d{1,2}, \d{4})/i);
  if (pref) return parseLongDate(pref[1]);
  return parseLongDate(head);
}

function pushUnique(bucket: string[], line: string, max: number): void {
  if (bucket.length >= max) return;
  const key = line.toLowerCase().slice(0, 72);
  if (bucket.some((x) => x.toLowerCase().slice(0, 72) === key)) return;
  bucket.push(clip(line, 220));
}

/** Group filing sentences into a summary, highlights, and a management SWOT. */
export function mineProse(raw: string): MinedProse {
  const text = reflow(raw);
  const eventDate = eventDateFromText(text);
  const openCut = text.search(/open the floor|question-and-answer|q\s*&\s*a session|we will now take questions/i);
  const opening = openCut > 200 ? text.slice(0, openCut) : text;
  const ranked = (src: string, bonus: number) =>
    sentencesOf(src)
      .map((s) => ({ s, n: substance(s) + bonus }))
      .filter((x) => x.n >= 3)
      .sort((a, b) => b.n - a.n);

  const rankedAll = ranked(text, 0);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const row of [...ranked(opening, 2), ...rankedAll]) {
    const key = row.s.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(row.s);
    if (picked.length >= 12) break;
  }

  const swot = emptySwot();
  for (const s of picked) {
    const b = bucketOf(s);
    if (b) pushUnique(swot[b], s, 3);
  }
  // Headwinds often show up in answers, after the opening boasts. Pull those
  // in even when they are not the highest-scoring lines.
  for (const row of rankedAll) {
    const b = bucketOf(row.s);
    if (b === 'willEndure' || b === 'threats' || b === 'weaknesses') pushUnique(swot[b], row.s, 3);
  }
  // A guidance line can also be the thing they will do; if willDo is empty,
  // lift the first guidance-like highlight into it.
  if (!swot.willDo.length) {
    const g = picked.find((s) => /guidance|we will|we expect|we plan/i.test(s));
    if (g) pushUnique(swot.willDo, g, 3);
  }

  const highlights = picked.slice(0, 5).map((s) => clip(s, 220));
  const summary = clip(highlights.slice(0, 3).join(' '), 560);
  return { eventDate, summary, highlights, swot, tone: toneOf(rankedAll.slice(0, 40).map((r) => r.s)) };
}

export function mineRating(raw: string): { action: string; summary: string } {
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const bits = text
    .split(/(?<=[.])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) =>
      s.length > 40 && s.length < 400
      && /re-?affirm|affirm|upgrad|downgrad|outlook|AAA|AA\+|CRISIL [A-Z]|ICRA [A-Z]|CARE [A-Z]/i.test(s)
      && !isBoilerplate(s),
    );
  const blob = `${text.slice(0, 4000)} ${bits.slice(0, 4).join(' ')}`.toLowerCase();
  let action = 'update';
  if (/downgrad/.test(blob)) action = 'downgraded';
  else if (/\bupgrad/.test(blob)) action = 'upgraded';
  else if (/re-?affirm/.test(blob)) action = 'affirmed';
  else if (/\bassigned\b/.test(blob)) action = 'assigned';
  return { action, summary: clip(bits.slice(0, 2).join(' '), 420) };
}

function section(html: string, marker: string, span = 28000): string {
  const i = html.indexOf(marker);
  if (i < 0) return '';
  return html.slice(i, i + span);
}

function parseConcallMarkdown(text: string): { period: string | null; url: string }[] {
  const out: { period: string | null; url: string }[] = [];
  const re = /(?:^|\n)\*\s+([A-Z][a-z]{2}\s+20\d{2})\s*\n+\[Transcript\]\((https?:\/\/[^)\s]+)/g;
  for (const m of text.matchAll(re)) {
    out.push({ period: m[1], url: m[2] });
    if (out.length >= 2) break;
  }
  return out;
}

export function parseConcallLinks(html: string): { period: string | null; url: string }[] {
  const sec = section(html, 'class="documents concalls');
  if (!sec) return parseConcallMarkdown(html);
  const out: { period: string | null; url: string }[] = [];
  for (const li of sec.split(/<li\b/).slice(1)) {
    const period = (li.match(/\b([A-Z][a-z]{2}\s+20\d{2})\b/) ?? [])[1] ?? null;
    const tr = li.match(/href="([^"]+)"[^>]*title="Raw Transcript"/i);
    if (!tr) continue;
    const url = tr[1].replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ period, url });
    if (out.length >= 2) break;
  }
  return out;
}

function announcementFromMarkdown(label: string, url: string): { title: string; url: string; date: string | null } | null {
  const head = label.split(' - ')[0].replace(/\s+\d+\s*h$/i, '').trim();
  const dated = head.match(/^(.*?)(?:\s+)(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+20\d{2})?)$/);
  const title = (dated ? dated[1] : head).trim();
  if (title.length < 8 || /^annual report/i.test(title)) return null;
  const date = dated ? parseLooseDate(dated[2]) : null;
  return { title: clip(title, 180), url, date };
}

export function parseAnnouncements(html: string): { title: string; url: string; date: string | null }[] {
  const start = html.indexOf('>Announcements<');
  if (start < 0) {
    const mark = html.search(/#{2,3}\s+Announcements/i);
    if (mark < 0) return [];
    const end = html.slice(mark + 10).search(/\n#{2,3}\s+/);
    const sec = html.slice(mark, end > 0 ? mark + 10 + end : mark + 8000);
    const out: { title: string; url: string; date: string | null }[] = [];
    for (const m of sec.matchAll(/\*\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const row = announcementFromMarkdown(m[1], m[2]);
      if (!row) continue;
      out.push(row);
      if (out.length >= 6) break;
    }
    return out;
  }
  const end = html.indexOf('annual-reports', start);
  const sec = html.slice(start, end > start ? end : start + 22000);
  const out: { title: string; url: string; date: string | null }[] = [];
  for (const m of sec.matchAll(/<a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    const inner = m[2];
    const title = inner.split(/<div|<time|<span/i)[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length < 8) continue;
    const stamp = (inner.match(/datetime="([^"]+)"/) ?? [])[1] ?? '';
    const date = stamp ? stamp.slice(0, 10) : null;
    out.push({ title: clip(title, 180), url, date });
    if (out.length >= 6) break;
  }
  return out;
}

export function parseAnnualLink(html: string): { url: string; label: string; year: string | null } | null {
  const sec = section(html, 'class="documents annual-reports', 6000);
  const m = sec.match(/href="([^"]+)"[^>]*>\s*Annual Report\s+(\d{4})/i);
  if (m) return { url: m[1].replace(/&amp;/g, '&'), label: `Annual Report ${m[2]}`, year: m[2] };
  const md = html.match(/\[Annual Report\s+(\d{4})\]\((https?:\/\/[^)\s]+)\)/i);
  if (!md) return null;
  return { url: md[2], label: `Annual Report ${md[1]}`, year: md[1] };
}

export function parseRatingLink(html: string, today = new Date()): DocLink | null {
  const sec = section(html, 'class="documents credit-ratings', 9000);
  const md = html.match(/\[(Rating update[^\]]*)\]\((https?:\/\/[^)\s]+)\)/i);
  const m = sec.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ?? (md ? [md[0], md[2], md[1]] as RegExpMatchArray : null);
  if (!m) return null;
  const url = m[1].replace(/&amp;/g, '&');
  const inner = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const agency = /crisil/i.test(url) ? 'CRISIL' : /icra/i.test(url) ? 'ICRA' : /careratings/i.test(url) ? 'CARE' : /indiaratings/i.test(url) ? 'India Ratings' : 'Rating';
  return { url, label: `${agency} rating`, date: parseLooseDate(inner, today) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function move(series: PxBar[], eventDay: string): { prev: number; on: number; later: number; sessions: number } | null {
  const i = series.findIndex((b) => b.day >= eventDay);
  if (i <= 0) return null;
  const last = Math.min(i + 4, series.length - 1);
  if (last < i) return null;
  return { prev: series[i - 1].c, on: series[i].c, later: series[last].c, sessions: last - (i - 1) };
}

/** Close-to-close from the session before the filing through that day and five sessions. */
export function priceReaction(stock: PxBar[], market: PxBar[], eventDay: string | null): PriceMove {
  const empty: PriceMove = {
    return1d: null, return5d: null, excess1d: null, excess5d: null, sessions: 0, priceBefore: null, priceAfter: null,
  };
  if (!eventDay) return empty;
  const s = move(stock, eventDay);
  if (!s || s.prev <= 0) return empty;
  const return1d = round2(((s.on / s.prev) - 1) * 100);
  const return5d = round2(((s.later / s.prev) - 1) * 100);
  const m = move(market, eventDay);
  const excess1d = m && m.prev > 0 ? round2(return1d - ((m.on / m.prev) - 1) * 100) : null;
  const excess5d = m && m.prev > 0 ? round2(return5d - ((m.later / m.prev) - 1) * 100) : null;
  return { return1d, return5d, excess1d, excess5d, sessions: s.sessions, priceBefore: round2(s.prev), priceAfter: round2(s.on) };
}

export function matchNews(
  prose: string,
  articles: { title: string; source: string; url: string; publishedAt: string }[],
  eventDay: string | null,
  ignore: string[],
): NewsHit[] {
  const skip = new Set(ignore.map((t) => t.toLowerCase()));
  const nameBlob = ignore.join(' ').toLowerCase();
  const tokens = [...new Set(
    prose.toLowerCase().replace(/[^a-z0-9% ]/g, ' ').split(/\s+/).filter((t) => {
      if (t.length < 5 || GENERIC.has(t) || skip.has(t)) return false;
      if (nameBlob.includes(t)) return false;
      return true;
    }),
  )];
  if (!tokens.length) return [];
  const scored = articles.map((a) => {
    const title = a.title.toLowerCase();
    const hit = tokens.filter((t) => title.includes(t));
    const distinctive = hit.filter((t) => t.length >= 6);
    if (distinctive.length < 1 && hit.length < 2) return null;
    const published = Date.parse(a.publishedAt);
    const event = eventDay ? Date.parse(`${eventDay}T00:00:00Z`) : NaN;
    const days = Number.isFinite(published) && Number.isFinite(event) ? Math.abs(published - event) / 86_400_000 : 99;
    const aroundFiling = days <= 12;
    return { a, hit, score: hit.length + (aroundFiling ? 2 : 0) - days / 30, aroundFiling };
  }).filter((x): x is NonNullable<typeof x> => x != null);
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: NewsHit[] = [];
  for (const row of scored) {
    const key = row.a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: row.a.title,
      source: row.a.source,
      url: row.a.url,
      publishedAt: row.a.publishedAt,
      overlap: row.hit.slice(0, 4).join(', '),
      aroundFiling: row.aroundFiling,
    });
    if (out.length >= 4) break;
  }
  return out;
}
