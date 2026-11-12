import assert from 'node:assert/strict';
import {
  matchNews,
  mineProse,
  mineRating,
  parseAnnouncements,
  parseConcallLinks,
  priceReaction,
} from './concall-mine.ts';

const transcript = `
October 28, 2026
Sub: Transcript of the earnings call conducted after the Meeting of the Board of directors on October 16, 2026.
Salil Parekh
Thank you for joining us. Revenue growth for the quarter was 2% and large deals were $3 bn. Operating margin was stable at 21%.
Based on the quarter, our revenue growth guidance is 2% to 4% in constant currency. We will continue working on productivity.
Jayesh Sanghrajka
As you look forward we will have impact from compensation increases. That will have a headwind. We will see pricing intensity as a headwind and we will continue the cost program to offset as much as possible.
Demand is softer and discretionary spending is lower than we expected. The deal pipeline is healthy and includes mega deals in new markets.
Analyst One
Could you help us understand why the margin fell this quarter and what the guidance cut really means for next year?
Salil Parekh
We will now open the floor for questions.
`;

const mined = mineProse(transcript);
assert.equal(mined.eventDate, '2026-10-16', `event date parsed as ${mined.eventDate}`);
assert.ok(mined.summary.length > 40, 'summary empty');
assert.ok(mined.highlights.length >= 3, 'too few highlights');
assert.ok(mined.highlights.every((h) => !h.includes('?')), 'a question leaked into highlights');
assert.ok(
  mined.swot.willDo.some((s) => /guidance|we will/i.test(s)),
  `willDo missing guidance: ${JSON.stringify(mined.swot.willDo)}`,
);
assert.ok(
  mined.swot.willEndure.some((s) => /headwind/i.test(s) && /offset|continue/i.test(s)),
  `willEndure missing the response: ${JSON.stringify(mined.swot.willEndure)}`,
);
assert.ok(
  mined.swot.weaknesses.some((s) => /softer|lower than/i.test(s)),
  `weaknesses missing: ${JSON.stringify(mined.swot.weaknesses)}`,
);
assert.ok(mined.tone === 'cautious' || mined.tone === 'mixed', `tone ${mined.tone}`);

const rating = mineRating(
  'CRISIL has reaffirmed its CRISIL AAA stable rating on the long-term bank facilities of the company. The outlook remains stable on the back of a strong liquidity position.',
);
assert.equal(rating.action, 'affirmed');
assert.ok(/AAA/.test(rating.summary));

const html = `
<div class="documents concalls flex-column">
  <li class="flex">
    <div class="nowrap">Oct 2026</div>
    <a class="button-chip" href="https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=abc.pdf" title="Raw Transcript">Transcript</a>
  </li>
  <li class="flex">
    <div class="nowrap">Jul 2026</div>
    <a class="button-chip" href="https://www.bseindia.com/x.pdf" title="Raw Transcript">Transcript</a>
  </li>
</div>
<h3>Announcements</h3>
<ul>
  <li><a href="https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=ann.pdf">Board outcome on buyback
    <div class="ink-600"><time datetime="2026-10-16T18:00:00+05:30">16 Oct</time></div>
  </a></li>
</ul>
<div class="documents annual-reports">
`;
const calls = parseConcallLinks(html);
assert.equal(calls.length, 2);
assert.equal(calls[0].period, 'Oct 2026');
assert.ok(calls[0].url.includes('abc.pdf'));
const anns = parseAnnouncements(html);
assert.equal(anns.length, 1);
assert.equal(anns[0].date, '2026-10-16');
assert.ok(/buyback/i.test(anns[0].title));

const stock = [
  { day: '2026-10-15', c: 100 },
  { day: '2026-10-16', c: 104 },
  { day: '2026-10-17', c: 103 },
  { day: '2026-10-20', c: 106 },
  { day: '2026-10-21', c: 108 },
  { day: '2026-10-22', c: 110 },
];
const nifty = stock.map((b, i) => ({ day: b.day, c: 100 + i }));
const px = priceReaction(stock, nifty, '2026-10-16');
assert.equal(px.return1d, 4);
assert.equal(px.priceBefore, 100);
assert.equal(px.priceAfter, 104);
assert.ok(px.return5d != null && px.return5d > 4);
assert.ok(px.excess1d != null && px.excess1d < px.return1d);

const hits = matchNews(
  mined.summary + ' guidance margin pipeline',
  [
    { title: 'Infosys narrows revenue guidance after softer quarter', source: 'Mint', url: 'https://news.example/a', publishedAt: '2026-10-17T04:00:00Z' },
    { title: 'Cricket world cup final draws record viewers', source: 'Wire', url: 'https://news.example/b', publishedAt: '2026-10-17T04:00:00Z' },
  ],
  '2026-10-16',
  ['infosys'],
);
assert.equal(hits.length, 1);
assert.equal(hits[0].aroundFiling, true);
assert.ok(/guidance|softer|pipeline/.test(hits[0].overlap));

console.log('concall-mine: ok');
