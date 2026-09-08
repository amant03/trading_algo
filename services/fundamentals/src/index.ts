import {
  pool,
  query,
  logger,
  publishBatch,
  TOPICS,
  dbReady,
  kafkaReady,
  waitForInstruments,
  Fundamentals,
  CompanyRelation,
  Instrument,
} from '@trading/shared';
import { generateCompany } from './generate.js';

async function loadInstruments(): Promise<Instrument[]> {
  const res = await query<{
    id: number;
    symbol: string;
    name: string;
    exchange: string;
    segment: string;
    sector: string | null;
    industry: string | null;
    base_price: number;
    lot_size: number;
    tick_size: number;
    market_cap: number | null;
    volatility: number;
  }>(
    `SELECT id, symbol, name, exchange, segment, sector, industry, base_price, lot_size, tick_size, market_cap, volatility
     FROM instruments WHERE status = 'ACTIVE' ORDER BY id`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    segment: r.segment,
    sector: r.sector,
    industry: r.industry,
    basePrice: Number(r.base_price),
    lotSize: Number(r.lot_size),
    tickSize: Number(r.tick_size),
    marketCap: r.market_cap == null ? null : Number(r.market_cap),
    volatility: Number(r.volatility),
  }));
}

async function upsertFundamentals(f: Fundamentals): Promise<void> {
  await query(
    `INSERT INTO fundamentals (
       instrument_id, sector, industry, description, market_cap, pe, pb, ps, peg, roe, roce, roa,
       debt_to_equity, current_ratio, quick_ratio, gross_margin, operating_margin, net_margin,
       revenue, revenue_growth, net_income, net_income_growth, employees, dividend_yield, eps,
       book_value, beta, fifty_two_week_high, fifty_two_week_low, avg_volume, promoter_holding,
       fii_holding, investability_score, investability_grade
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
     )
     ON CONFLICT (instrument_id) DO UPDATE SET
       sector = EXCLUDED.sector, industry = EXCLUDED.industry, description = EXCLUDED.description,
       market_cap = EXCLUDED.market_cap, pe = EXCLUDED.pe, pb = EXCLUDED.pb, ps = EXCLUDED.ps,
       peg = EXCLUDED.peg, roe = EXCLUDED.roe, roce = EXCLUDED.roce, roa = EXCLUDED.roa,
       debt_to_equity = EXCLUDED.debt_to_equity, current_ratio = EXCLUDED.current_ratio,
       quick_ratio = EXCLUDED.quick_ratio, gross_margin = EXCLUDED.gross_margin,
       operating_margin = EXCLUDED.operating_margin, net_margin = EXCLUDED.net_margin,
       revenue = EXCLUDED.revenue, revenue_growth = EXCLUDED.revenue_growth,
       net_income = EXCLUDED.net_income, net_income_growth = EXCLUDED.net_income_growth,
       employees = EXCLUDED.employees, dividend_yield = EXCLUDED.dividend_yield, eps = EXCLUDED.eps,
       book_value = EXCLUDED.book_value, beta = EXCLUDED.beta,
       fifty_two_week_high = EXCLUDED.fifty_two_week_high,
       fifty_two_week_low = EXCLUDED.fifty_two_week_low, avg_volume = EXCLUDED.avg_volume,
       promoter_holding = EXCLUDED.promoter_holding, fii_holding = EXCLUDED.fii_holding,
       investability_score = EXCLUDED.investability_score,
       investability_grade = EXCLUDED.investability_grade,
       updated_at = now()`,
    [
      f.instrumentId, f.sector, f.industry, f.description, f.marketCap, f.pe, f.pb, f.ps, f.peg,
      f.roe, f.roce, f.roa, f.debtToEquity, f.currentRatio, f.quickRatio, f.grossMargin,
      f.operatingMargin, f.netMargin, f.revenue, f.revenueGrowth, f.netIncome, f.netIncomeGrowth,
      f.employees, f.dividendYield, f.eps, f.bookValue, f.beta, f.fiftyTwoWeekHigh,
      f.fiftyTwoWeekLow, f.avgVolume, f.promoterHolding, f.fiiHolding, f.investabilityScore,
      f.investabilityGrade,
    ],
  );
}

async function replaceRelations(relations: CompanyRelation[]): Promise<void> {
  if (!relations.length) return;
  const instId = relations[0].instrumentId;
  await query('DELETE FROM company_relations WHERE instrument_id = $1', [instId]);
  const params: (number | string | null)[] = [];
  const values = relations
    .map((r, idx) => {
      const p = idx * 6;
      params.push(r.instrumentId, r.relationType, r.entityName, r.entitySymbol, r.weight, r.note);
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6})`;
    })
    .join(',');
  await query(
    `INSERT INTO company_relations (instrument_id, relation_type, entity_name, entity_symbol, weight, note) VALUES ${values}`,
    params,
  );
}

async function runOnce(): Promise<number> {
  const [instruments, peers] = await Promise.all([loadInstruments(), loadInstruments()]);
  let published = 0;
  for (const inst of instruments) {
    const { fundamentals, relations } = generateCompany(inst, peers);
    await upsertFundamentals(fundamentals);
    await replaceRelations(relations);
    await publishBatch(TOPICS.fundamentals, [{ payload: fundamentals, key: inst.symbol }]);
    published += 1;
  }
  return published;
}

async function main(): Promise<void> {
  logger.info('fundamentals service starting...');
  if (!(await dbReady())) throw new Error('PostgreSQL unavailable');
  if (!(await kafkaReady())) throw new Error('Kafka unavailable');

  // The universe is seeded by market-data — wait for it before first publish.
  const count = await waitForInstruments();
  logger.info({ instruments: count }, 'instrument universe ready');
  const first = await runOnce();
  logger.info({ companies: first }, 'fundamentals generated & published');

  // periodic refresh picks up new instruments (keeps the feed warm)
  const timer = setInterval(async () => {
    try {
      const done = await runOnce();
      logger.info({ companies: done }, 'fundamentals refreshed');
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'fundamentals refresh failed');
    }
  }, 5 * 60 * 1000);

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err as Error }, 'fundamentals fatal');
  process.exit(1);
});
