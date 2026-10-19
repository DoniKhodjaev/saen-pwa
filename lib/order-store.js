// All keys share a hash tag. Orders and deduplication records deliberately have NO TTL.
export const REQUEST_LIMIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return n <= 60 and 1 or 0`;
export const ADMIT = `
local old = redis.call('GET', KEYS[1])
if old then
  if cjson.decode(old).fingerprint ~= ARGV[1] then return {'conflict'} end
  return {'existing', old}
end
local limits = {10, 3, 100}
for i = 2,4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= limits[i-1] then return {'limited'} end
end
for i = 2,4 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], 3600) end
end
redis.call('SET', KEYS[1], ARGV[2])
if ARGV[4] == 'live' then redis.call('ZADD', KEYS[5], ARGV[3], ARGV[5]) end
return {'created', ARGV[2]}`;
export const FINISH = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.fingerprint ~= ARGV[1] or record.notification.status ~= 'sending' then return 0 end
record.notification = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(record))
if record.notification.status == 'sent' then redis.call('ZREM', KEYS[2], ARGV[3]) end
return 1`;
export function createStore(env, fetchImpl = fetch) {
  const prefix = `saen:{orders}:${env.ORDER_MODE}:`;
  async function command(...args) {
    // Do NOT retry an indeterminate write: the admission may already have committed.
    const response = await fetchImpl(env.UPSTASH_REDIS_REST_URL, {
      method:'POST', headers:{ Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
      body:JSON.stringify(args), signal:AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('STORE_UNAVAILABLE');
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('STORE_UNAVAILABLE');
    return data.result;
  }
  return {
    async allowRequest(ip) { return (await command('EVAL', REQUEST_LIMIT, 1, prefix+'request:'+ip)) === 1; },
    async get(id) {
      const raw = await command('GET', prefix+'order:'+id);
      return raw ? JSON.parse(raw) : null;
    },
    async admit(record, ip, phone) {
      const result = await command('EVAL', ADMIT, 5, prefix+'order:'+record.order.id,
        prefix+'ip:'+ip, prefix+'phone:'+phone, prefix+'global', prefix+'review',
        record.fingerprint, JSON.stringify(record), record.receivedAt, record.mode, record.order.id);
      return { kind:result[0], record:result[1] ? JSON.parse(result[1]) : null };
    },
    async finish(record, notification) {
      const result = await command('EVAL', FINISH, 2, prefix+'order:'+record.order.id, prefix+'review',
        record.fingerprint, JSON.stringify(notification), record.order.id);
      if (result !== 1) throw new Error('STORE_UNAVAILABLE');
    },
  };
}
