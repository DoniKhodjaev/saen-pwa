import { parse, priceOrder, digest, OrderError, telegramMessage } from './orders.js';
import { createStore } from './order-store.js';
const MAX_BODY = 16384;
function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', ...headers,
  } });
}
async function readJSON(req) {
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw new OrderError('BODY_TOO_LARGE', 413);
  if (!req.body) throw new OrderError('INVALID_JSON');
  const reader = req.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new OrderError('BODY_TOO_LARGE', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
  catch { throw new OrderError('INVALID_JSON'); }
}
function configured(env) {
  if (!['mock','live'].includes(env.ORDER_MODE) || !env.ORDER_ALLOWED_ORIGINS || !env.ORDER_HASH_SECRET || env.ORDER_HASH_SECRET.length < 32 ||
      !/^https:\/\//.test(env.UPSTASH_REDIS_REST_URL || '') || !env.UPSTASH_REDIS_REST_TOKEN) return false;
  if (env.ORDER_MODE === 'mock' && env.VERCEL_ENV === 'production') return false;
  if (env.ORDER_MODE === 'live' && (env.VERCEL_ENV !== 'production' || !/^\d+:[\w-]+$/.test(env.TELEGRAM_BOT_TOKEN || '') || !/^-?\d+$/.test(env.TELEGRAM_CHAT_ID || ''))) return false;
  return true;
}
function accepted(record, replayed = false) {
  return reply(200, { ok:true, accepted:true, orderId:record.order.id, total:record.order.total,
    notification:record.notification.status, mode:record.mode, replayed });
}
export function createHandler({ env = process.env, fetchImpl = fetch, store: suppliedStore, now = Date.now,
  log = (event, id) => console.error(event, id || '') } = {}) {
  return async req => {
    if (req.method !== 'POST') return reply(405, { ok:false, code:'METHOD_NOT_ALLOWED' }, { Allow:'POST' });
    if (!configured(env)) return reply(503, { ok:false, code:'CHECKOUT_UNAVAILABLE' }, { 'Retry-After':'60' });
    const origin = req.headers.get('origin');
    const allowed = env.ORDER_ALLOWED_ORIGINS.split(',').map(s => s.trim());
    if (!origin || !allowed.includes(origin) || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { ok:false, code:'ORIGIN_DENIED' });
    if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get('content-type') || '')) return reply(415, { ok:false, code:'JSON_REQUIRED' });
    const store = suppliedStore || createStore(env, fetchImpl);
    try {
      // Vercel overwrites x-forwarded-for for direct deployments. No user-selected fallback header.
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim();
      if (!ip || ip.length > 64) throw new Error('MISSING_TRUSTED_IP');
      const ipHash = await digest('ip:'+ip, env.ORDER_HASH_SECRET);
      if (!await store.allowRequest(ipHash)) return reply(429, { ok:false, code:'RATE_LIMITED' }, { 'Retry-After':'60' });
      const intent = parse(await readJSON(req), now());
      const fingerprint = await digest(JSON.stringify(intent));
      const existing = await store.get(intent.id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new OrderError('IDEMPOTENCY_CONFLICT', 409);
        return accepted(existing, true); // works even after catalog/version changes
      }
      const order = priceOrder(intent);
      const receivedAt = now();
      const record = { fingerprint, order, receivedAt, mode:env.ORDER_MODE,
        notification:{ status:env.ORDER_MODE === 'live' ? 'sending' : 'disabled', attemptedAt:receivedAt } };
      const phoneHash = await digest('phone:'+order.contact.phone, env.ORDER_HASH_SECRET);
      const admission = await store.admit(record, ipHash, phoneHash);
      if (admission.kind === 'conflict') throw new OrderError('IDEMPOTENCY_CONFLICT', 409);
      if (admission.kind === 'limited') return reply(429, { ok:false, code:'RATE_LIMITED' }, { 'Retry-After':'3600' });
      if (admission.kind === 'existing') return accepted(admission.record, true);
      if (admission.kind !== 'created') throw new Error('STORE_UNAVAILABLE');
      if (env.ORDER_MODE === 'mock') return accepted(record);
      // Durable sending claim already exists. Never automatically resend after this boundary.
      // Telegram has no idempotency key: a lost response must go to manual reconciliation.
      let notification;
      try {
        const tg = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method:'POST', headers:{ 'Content-Type':'application/json' }, signal:AbortSignal.timeout(7000),
          body:JSON.stringify({ chat_id:env.TELEGRAM_CHAT_ID, text:telegramMessage(order,receivedAt), parse_mode:'HTML', disable_web_page_preview:true }),
        });
        const data = await tg.json();
        notification = tg.ok && data.ok === true && Number.isSafeInteger(data.result?.message_id)
          ? { status:'sent', messageId:data.result.message_id, completedAt:now() }
          : { status:'needs_review', reason:'TELEGRAM_REJECTED', completedAt:now() };
      } catch {
        notification = { status:'needs_review', reason:'DELIVERY_UNCERTAIN', completedAt:now() };
      }
      try { await store.finish(record, notification); record.notification = notification; }
      catch { log('ORDER_NOTIFICATION_STATE_UNCERTAIN', order.id); }
      if (record.notification.status !== 'sent') log('ORDER_NOTIFICATION_REVIEW', order.id);
      return accepted(record);
    } catch (error) {
      if (error instanceof OrderError) return reply(error.status, { ok:false, code:error.code });
      // Never log exception URLs/bodies: upstream errors can contain credentials or personal data.
      log('ORDER_SERVICE_UNAVAILABLE');
      return reply(503, { ok:false, code:'SERVICE_UNAVAILABLE' }, { 'Retry-After':'60' });
    }
  };
}
