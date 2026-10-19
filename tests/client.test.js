import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../app/order-client.js';
import { order } from './helpers.js';
function storage() {
  const map=new Map();return { get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)) };
}
const accepted=o=>Response.json({ok:true,accepted:true,orderId:o.id,total:o.total,notification:'sent',mode:'live'});
function create(options={}) {return SaenOrders.create({storage:storage(),online:()=>true,...options});}
test('offline order survives reload and is sent with the same ID after reconnect',async()=>{
  const s=storage();const o=order();let online=false,calls=0;
  let q=create({storage:s,online:()=>online,fetchImpl:async()=>{calls++;return accepted(o);}});
  q.add(o);await q.flush();assert.equal(calls,0);
  online=true;q=create({storage:s,online:()=>online,fetchImpl:async(_,args)=>{calls++;assert.equal(JSON.parse(args.body).id,o.id);return accepted(o);}});
  await q.flush();assert.equal(q.list()[0].sync.status,'accepted');assert.equal(calls,1);
});
test('loss of response retries persisted payload; concurrent flush shares in-flight work',async()=>{
  let now=Date.now(),calls=0;const o=order();
  const q=create({now:()=>now,fetchImpl:async()=>{calls++;if(calls===1)throw Error('offline');return accepted(o);}});
  q.add(o);await Promise.all([q.flush(),q.flush(),q.flush()]);assert.equal(calls,1);
  await q.flush();assert.equal(calls,1);now+=60000;await q.flush();assert.equal(calls,2);assert.equal(q.list()[0].sync.status,'accepted');
});
test('storage failure prevents dispatch and confirmation; bad local record retained',async()=>{
  let calls=0;const s=storage();s.setItem=()=>{throw Error('QuotaExceededError');};
  const q=create({storage:s,fetchImpl:async()=>{calls++;}});assert.throws(()=>q.add(order()));await q.flush();assert.equal(calls,0);
  const bad=storage();bad.setItem(SaenOrders.PREFIX+'broken','{');assert.deepEqual(create({storage:bad}).list(),[]);assert.equal(bad.length,1);
});
test('per-order keys preserve orders from multiple tabs and accepted state wins over stale network failure',async()=>{
  const s=storage();let now=Date.now();const a=order(),b=order();
  const q1=create({storage:s,now:()=>now,fetchImpl:async()=>{throw Error('network');}}),q2=create({storage:s,now:()=>now});
  q1.add(a);q2.add(b);assert.equal(q1.list().length,2);
  let release;const waiting=new Promise(r=>{release=r;});
  const slow=create({storage:s,now:()=>now,fetchImpl:async()=>{await waiting;throw Error('lost');}});
  const pending=slow.flush();await new Promise(r=>setImmediate(r));
  const entry=slow.list().find(x=>x.order.id===a.id);entry.sync.status='accepted';s.setItem(SaenOrders.PREFIX+a.id,JSON.stringify(entry));
  release();await pending;assert.equal(slow.list().find(x=>x.order.id===a.id).sync.status,'accepted');
});
for (const status of [400,403,409,413,415])test('permanent HTTP '+status+' blocks automatic retries',async()=>{
  let now=Date.now(),calls=0;const q=create({now:()=>now,fetchImpl:async()=>{calls++;return Response.json({ok:false,code:'INVALID_ORDER'},{status});}});
  q.add(order());await q.flush();now+=7200000;await q.flush();assert.equal(calls,1);assert.equal(q.list()[0].sync.status,'blocked');
});
test('429 honors Retry-After; 503 and invalid JSON stay queued',async()=>{
  let now=Date.now(),calls=0;const o=order();const q=create({now:()=>now,fetchImpl:async()=>{
    calls++;if(calls===1)return Response.json({code:'RATE_LIMITED'},{status:429,headers:{'retry-after':'60'}});
    if(calls===2)return new Response('gateway',{status:503});return accepted(o);
  }});q.add(o);await q.flush();now+=59000;await q.flush();assert.equal(calls,1);now+=2000;await q.flush();assert.equal(calls,2);
  assert.equal(q.list()[0].sync.status,'queued');now+=60000;await q.flush();assert.equal(q.list()[0].sync.status,'accepted');
});
test('wrong acknowledgement ID/total cannot confirm an order',async()=>{
  const q=create({fetchImpl:async()=>accepted(order())});q.add(order());await q.flush();assert.equal(q.list()[0].sync.status,'queued');
});

test('browser storage denied at startup does not throw until reading or saving',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('SecurityError');}});
  try {const q=SaenOrders.create();assert.throws(()=>q.list());assert.throws(()=>q.add(order()));}
  finally {delete globalThis.localStorage;if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);}
});

test('an actual aborted fetch timeout keeps the order queued',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const q=create({fetchImpl:(_,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('AbortError')));})});
  q.add(order());const pending=q.flush();t.mock.timers.tick(20001);await pending;
  assert.equal(q.list()[0].sync.status,'queued');assert.equal(q.list()[0].sync.code,'NETWORK_ERROR');
});
