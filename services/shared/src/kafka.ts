import { Kafka, Producer, Consumer, CompressionTypes, logLevel } from 'kafkajs';
import { config } from './config.js';
import { logger } from './logger.js';
import { TOPICS } from './topics.js';

let cachedClient: Kafka | null = null;

export function getKafka(): Kafka {
  if (!cachedClient) {
    cachedClient = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      logLevel: config.logLevel === 'debug' ? logLevel.DEBUG : logLevel.WARN,
      retry: {
        initialRetryTime: 300,
        retries: config.kafka.retries,
      },
    });
  }
  return cachedClient;
}

/** Create all application topics up-front so consumers never race auto-creation. */
export async function ensureTopics(): Promise<void> {
  const admin = getKafka().admin();
  try {
    await admin.connect();
    const existing = new Set(await admin.listTopics());
    const missing = Object.values(TOPICS).filter((t) => !existing.has(t));
    if (missing.length) {
      await admin.createTopics({
        topics: missing.map((t) => ({ topic: t, numPartitions: 3, replicationFactor: 1 })),
      });
      logger.info({ created: missing }, 'topics created');
    }
  } finally {
    await admin.disconnect().catch(() => void 0);
  }
}

const producers = new Map<string, Producer>();

/** Get a shared producer (idempotent, gzip-compressed) per label. */
export async function getProducer(label = 'default'): Promise<Producer> {
  const existing = producers.get(label);
  if (existing) return existing;

  const producer = getKafka().producer({
    allowAutoTopicCreation: true,
    idempotent: true,
    maxInFlightRequests: 5,
  });
  await producer.connect();
  producer.on('producer.connect', () => logger.debug({ label }, 'kafka producer connected'));
  producer.on('producer.disconnect', () => logger.warn({ label }, 'kafka producer disconnected'));
  producers.set(label, producer);
  return producer;
}

export interface ConsumeOptions {
  groupId?: string;
  eachBatch?: boolean;
  /** ms between consumer.lag or run() polls */
  heartbeatInterval?: number;
}

/** Consume a topic with a durable consumer group. Resilient to transient metadata errors. */
export async function consumeTopic<T>(
  topic: string,
  serviceName: string,
  handler: (messages: T[]) => Promise<void>,
  opts: ConsumeOptions = {},
): Promise<Consumer> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const groupId = opts.groupId ?? `${config.kafka.groupIdPrefix}-${serviceName}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 30; attempt++) {
    const consumer = getKafka().consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: opts.heartbeatInterval ?? 5000,
      maxBytesPerPartition: 5 * 1024 * 1024,
      retry: { retries: config.kafka.retries },
    });
    try {
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });
      const handlerFn = async ({ messages }: { messages: import('kafkajs').KafkaMessage[] }) => {
        const parsed: T[] = [];
        for (const m of messages) {
          if (!m.value) continue;
          try {
            parsed.push(JSON.parse(m.value.toString()) as T);
          } catch (err) {
            logger.warn({ err, topic }, 'failed to parse kafka message');
          }
        }
        if (parsed.length) await handler(parsed);
      };
      await consumer.run({
        eachBatch:
          opts.eachBatch === false
            ? undefined
            : async ({ batch }) => {
                await handlerFn({ messages: batch.messages });
              },
        eachMessage:
          opts.eachBatch === false
            ? async ({ message }) => {
                await handlerFn({ messages: [message] });
              }
            : undefined,
      });
      return consumer;
    } catch (err) {
      lastError = err;
      logger.warn({ attempt, topic, err: (err as Error).message }, 'consumer init failed, retrying');
      await consumer.disconnect().catch(() => void 0);
      await sleep(Math.min(1000 * attempt, 10_000));
    }
  }
  throw lastError;
}

export interface PublishOptions {
  key?: string;
  partition?: number;
}

export async function publish<T>(
  topic: string,
  payload: T,
  opts: PublishOptions = {},
): Promise<void> {
  const producer = await getProducer('core');
  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [{ key: opts.key, value: JSON.stringify(payload), partition: opts.partition }],
  });
}

/** Publish many messages in a single batch (fast path). */
export async function publishBatch<T>(
  topic: string,
  items: { payload: T; key?: string }[],
): Promise<void> {
  if (!items.length) return;
  const producer = await getProducer('core');
  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: items.map((it) => ({ key: it.key, value: JSON.stringify(it.payload) })),
  });
}

export async function kafkaReady(waitMs = 60_000): Promise<boolean> {
  const start = Date.now();
  const client = getKafka();
  const admin = client.admin();
  while (Date.now() - start < waitMs) {
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      logger.info({ topics: topics.length }, 'kafka connected');
      await admin.disconnect();
      await ensureTopics();
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'kafka not ready, retrying...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}
