import { createRelay } from './server.js';
const integer = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid ' + name);
  return value;
};
const { app } = createRelay({
  database: process.env.RELAY_DATABASE ?? './data/relay.sqlite',
  invite: process.env.RELAY_INVITE || undefined,
  inviteUses: integer('RELAY_INVITE_USES', 20),
  maxHosts: integer('RELAY_MAX_HOSTS', 100),
  maxConnections: integer('RELAY_MAX_CONNECTIONS', 500),
  maxPeersPerHost: integer('RELAY_MAX_PEERS', 8),
  messagesPerMinute: integer('RELAY_MESSAGES_PER_MINUTE', 6000),
  maxBufferedBytes: integer('RELAY_MAX_BUFFERED_BYTES', 1048576),
  allowedOrigins: (process.env.MOBILE_ORIGINS ?? 'http://127.0.0.1:5173').split(','),
});
await app.listen({ host: process.env.RELAY_BIND ?? '127.0.0.1', port: integer('RELAY_PORT', 4090) });
console.log('DSH Mobile relay listening');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
