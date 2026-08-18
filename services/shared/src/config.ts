import 'dotenv/config';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  pg: {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'trading_platform',
    user: process.env.PGUSER ?? 'trading_app',
    password: process.env.PGPASSWORD ?? 'trading_pass',
    max: Number(process.env.PG_POOL_SIZE ?? 10),
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? '127.0.0.1:9092').split(',').map((s) => s.trim()),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'trading-platform',
    groupIdPrefix: process.env.KAFKA_GROUP_PREFIX ?? 'trading',
    retries: Number(process.env.KAFKA_RETRIES ?? 8),
  },

  api: {
    port: Number(process.env.API_PORT ?? 8080),
  },

  sim: {
    speed: Number(process.env.SIM_SPEED ?? 6),
    candleIntervalSec: Number(process.env.CANDLE_INTERVAL_SEC ?? 3),
    seed: Number(process.env.SIM_SEED ?? 20240818),
  },
} as const;

export const isDev = config.nodeEnv !== 'production';
