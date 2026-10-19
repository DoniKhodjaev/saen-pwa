import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/notify-handler.js';
import { catalog, telegramMessage, priceOrder, parse } from '../lib/orders.js';
import { env, order, request, memoryStore } from './helpers.js';
function fixture(options = {}) {
  const store = memoryStore(); let sends = 0;
  const logs = [];
  const handler = createHandler({ env, store, log:(...args) => logs.push(args), fetchImpl:async () => {
    sends++; return Response.json({ ok:true, result:{ message_id:123 } });
  }, ...options });
  return { handler, store, logs, sends:() => sends };
}
test('only POST/JSON/same-origin; closed until configured; no secret details', async () => {
  const f = fixture();
  for (const [req, status] of [[request(null, {}, 'GET'),405], [request(order(), {'content-type':'text/plain'}),415],
    [request(order(), {origin:'https://attacker.test'}),403], [request(order(), {'sec-fetch-site':'cross-site'}),403],
    [request(order(), {origin:'null'}),403], [request('{'),400]]) {
    const res = await f.handler(req); assert.equal(res.status,status); assert.equal(res.headers.get('cache-control'),'no-store');
  }
  for (const overrides of [{ORDER_MODE:undefined}, {ORDER_MODE:'mock'}, {VERCEL_ENV:'preview'}, {ORDER_HASH_SECRET:'short'}, {TELEGRAM_BOT_TOKEN:''}]) {
    const h = createHandler({env:{...env,...overrides}, log:()=>{}});
    assert.equal((await h(request(order()))).status,503);
  }
  assert.equal(f.sends(),0);
});
const invalidCases = {
  'null': () => null,
  'non-array items': o => ({...o,items:{}}),
  'missing delivery': o => { delete o.delivery; return o; },
  'null delivery': o => ({...o,delivery:null}),
  'nonobject contact': o => ({...o,contact:'x'}),
  'empty items': o => ({...o,items:[]}),
  'duplicate items': o => ({...o,items:[...o.items,...o.items]}),
  'quantity injection': o => ({...o,items:[{...o.items[0],quantity:100}]}),
  'unknown field': o => ({...o,admin:true}),
  'unknown product': o => ({...o,items:[{n:'XX',price:100}]}),
  'negative money': o => ({...o,total:-1}),
  'NaN/string money': o => ({...o,total:'1887000'}),
  'fractional money': o => ({...o,total:0.5}),
  'invalid ID': o => ({...o,id:'1234'}),
  'invalid timestamp': o => ({...o,createdAt:'yesterday'}),
  'future timestamp': o => ({...o,createdAt:Date.now()+3600000}),
  'invalid phone': o => ({...o,contact:{...o.contact,phone:'+19999012345'}}),
  'phone text': o => ({...o,contact:{...o.contact,phone:'call 901234567'}}),
  'invalid email': o => ({...o,contact:{...o.contact,email:'<x>@example.com'}}),
  'control characters': o => ({...o,contact:{...o.contact,name:'line\nname'}}),
  'oversize name': o => ({...o,contact:{...o.contact,name:'a'.repeat(81)}}),
  'delivery type': o => ({...o,delivery:{type:'free'}}),
  'missing address': o => ({...o,delivery:{type:'delivery'}}),
  'long address': o => ({...o,delivery:{type:'delivery',address:'x'.repeat(241)}}),
  'too many items': o => ({...o,items:Array(8).fill(o.items[0])}),
};
for (const [name, mutate] of Object.entries(invalidCases)) test('rejects '+name, async () => {
  const f = fixture(); const response = await f.handler(request(mutate(order())));
  assert.equal(response.status,400); assert.equal(f.sends(),0); assert.equal(f.store.records.size,0);
});
test('bounds streamed body even without Content-Length', async () => {
  const f = fixture();
  assert.equal((await f.handler(request('x'.repeat(17000)))).status,413);
  assert.equal((await f.handler(request('{}', {'content-length':'17000'}))).status,413);
});
test('server catalog rejects changed prices/totals/version; all seven prices sum independently', async () => {
  const f = fixture();
  for (const o of [order({total:1}),order({items:[{n:'I',price:1}],total:1}),order({catalogVersion:'old'})]) {
    assert.equal((await f.handler(request(o))).status,409);
  }
  const items = catalog.products.map(p => ({ n:p.n, price:p.priceUzs }));
  const full = order({items,total:items.reduce((s,it)=>s+it.price,0), delivery:{type:'delivery',address:'Ташкент, улица Тестовая 1'}});
  const res = await f.handler(request(full)); assert.equal(res.status,200);
  assert.equal((await res.json()).total,12818000); assert.equal(f.sends(),1);
});
test('durable acceptance precedes Telegram; retry, concurrency, and response loss send once', async () => {
  const store = memoryStore(); let sends = 0;
  const handler = createHandler({env,store,log:()=>{},fetchImpl:async () => {
    assert.equal(store.records.size,1); sends++; await new Promise(resolve => setTimeout(resolve,10));
    return Response.json({ok:true,result:{message_id:1}});
  }});
  const o = order();
  const responses = await Promise.all(Array.from({length:12}, () => handler(request(o))));
  assert(responses.every(r => r.status === 200)); assert.equal(sends,1);
  // Discard first response, as if the connection died after successful Telegram delivery.
  assert.equal((await (await handler(request(o))).json()).replayed,true); assert.equal(sends,1);
  assert.equal((await handler(request({...o,total:1}))).status,409);
});
test('saved orders replay after catalog changes without validation against new prices', async () => {
  const f = fixture(); const o = order({catalogVersion:'previous-release'});
  // Previously accepted intent, now not in current catalog.
  const {digest} = await import('../lib/orders.js');
  const intent = parse(o);
  f.store.records.set(o.id,{fingerprint:await digest(JSON.stringify(intent)),order:o,mode:'live',notification:{status:'sent'}});
  assert.equal((await f.handler(request(o))).status,200); assert.equal(f.sends(),0);
});
for (const [name, fetchImpl] of [
  ['timeout or lost Telegram response',async()=>{throw Error('https://api.telegram.org/botSECRET');}],
  ['Telegram 429',async()=>Response.json({ok:false,description:'SECRET'},{status:429})],
  ['Telegram malformed response',async()=>new Response('<html>gateway</html>',{status:502})],
  ['Telegram invalid success',async()=>Response.json({ok:true})],
]) test(name+' preserves order and never automatically resends',async()=>{
  const store=memoryStore();let calls=0;
  const handler=createHandler({env,store,log:()=>{},fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
  const o=order();const response=await handler(request(o));
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.accepted,true);assert.equal(data.notification,'needs_review');
  assert(!JSON.stringify(data).includes('SECRET'));await handler(request(o));assert.equal(calls,1);
});
test('Redis failures fail closed; indeterminate completion retains sending claim',async()=>{
  for (const flag of ['failRead','failAdmit']) {
    const f=fixture();f.store[flag]=true;const res=await f.handler(request(order()));
    assert.equal(res.status,503);assert.equal(f.sends(),0);assert(!JSON.stringify(await res.json()).includes('secret'));
  }
  const f=fixture();f.store.failFinish=true;const o=order();const res=await f.handler(request(o));
  assert.equal((await res.json()).notification,'sending');await f.handler(request(o));assert.equal(f.sends(),1);
});
test('crash after durable claim is replayed without sending; request/order limits apply',async()=>{
  const f=fixture();f.store.requestAllowed=false;assert.equal((await f.handler(request(order()))).status,429);
  f.store.requestAllowed=true;f.store.limited=true;assert.equal((await f.handler(request(order()))).status,429);assert.equal(f.sends(),0);
});
test('mock mode stores acceptance without calling Telegram; message is escaped and bounded',async()=>{
  const f=fixture({env:{...env,ORDER_MODE:'mock',VERCEL_ENV:'preview'}});
  assert.equal((await f.handler(request(order()))).status,200);assert.equal(f.sends(),0);
  const o=priceOrder(parse(order({contact:{name:'<b>Test & Name</b>',phone:'90 123 45 67',email:''}})));
  const message=telegramMessage(o,Date.now());assert(message.includes('&lt;b&gt;Test &amp; Name&lt;/b&gt;'));assert(message.length<4096);
});
