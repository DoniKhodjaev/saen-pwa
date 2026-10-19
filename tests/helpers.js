import { randomUUID } from 'node:crypto';
import { catalog } from '../lib/orders.js';
export const env = {
  ORDER_MODE:'live', VERCEL_ENV:'production', ORDER_ALLOWED_ORIGINS:'https://saen.test',
  ORDER_HASH_SECRET:'test-only-secret-with-at-least-32-characters',
  UPSTASH_REDIS_REST_URL:'https://redis.test', UPSTASH_REDIS_REST_TOKEN:'not-real',
  TELEGRAM_BOT_TOKEN:'123456:test-only', TELEGRAM_CHAT_ID:'123456',
};
export function order(overrides = {}) {
  return { id:randomUUID(), catalogVersion:catalog.version, items:[{ n:'I', price:1887000 }], total:1887000,
    contact:{ name:'Тестовый клиент', phone:'+998901234567', email:'' }, delivery:{ type:'pickup', address:null },
    createdAt:Date.now(), ...overrides };
}
export function request(body, headers = {}, method = 'POST') {
  return new Request('https://saen.test/api/notify-order', { method,
    headers:{ origin:'https://saen.test', 'content-type':'application/json', 'x-forwarded-for':'192.0.2.1', ...headers },
    ...(method === 'POST' ? { body:typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
export function memoryStore() {
  const records = new Map();
  return {
    records, requestAllowed:true, failRead:false, failAdmit:false, failFinish:false, limited:false,
    async allowRequest() { return this.requestAllowed; },
    async get(id) { if (this.failRead) throw Error('secret upstream'); return structuredClone(records.get(id) || null); },
    async admit(record) {
      if (this.failAdmit) throw Error('secret upstream');
      const old = records.get(record.order.id);
      if (old) return { kind:old.fingerprint === record.fingerprint ? 'existing' : 'conflict', record:structuredClone(old) };
      if (this.limited) return { kind:'limited' };
      records.set(record.order.id, structuredClone(record));
      return { kind:'created', record };
    },
    async finish(record, notification) {
      if (this.failFinish) throw Error('secret upstream');
      records.get(record.order.id).notification = notification;
    },
  };
}
