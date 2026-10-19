import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {createStore} from '../lib/order-store.js';
import {createHandler} from '../lib/notify-handler.js';
import {env,order,request} from './helpers.js';
const exec=promisify(execFile);
const server=process.env.REDIS_SERVER || 'redis-server';
const cli=process.env.REDIS_CLI || 'redis-cli';
let available=true;
try{await exec(server,['--version']);await exec(cli,['--version']);}catch{available=false;}
if(!available && process.env.REQUIRE_REDIS_TESTS) throw Error('Redis integration is mandatory in CI: install redis-server/redis-cli');
test('real Redis Lua: atomic deduplication, payload conflicts, limits, durable records and review queue', {skip:!available}, async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'saen-redis-'));
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(server,['--bind','127.0.0.1','--port',String(port),'--dir',dir,'--save','','--appendonly','no'],{stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}await rm(dir,{recursive:true,force:true});});
  async function command(...args){const {stdout}=await exec(cli,['-h','127.0.0.1','-p',String(port),'--json',...args.map(String)],{timeout:5000});return JSON.parse(stdout);}
  for(let i=0;i<50;i++){try{await command('PING');break;}catch{if(i===49)throw Error('Redis did not start');await new Promise(r=>setTimeout(r,20));}}
  let restCalls=0;
  const rest=async(url,init)=>{
    restCalls++;assert.equal(url,env.UPSTASH_REDIS_REST_URL);assert.equal(init.headers.Authorization,'Bearer '+env.UPSTASH_REDIS_REST_TOKEN);
    return Response.json({result:await command(...JSON.parse(init.body))});
  };
  const store=createStore(env,rest);const prefix='saen:{orders}:live:';
  await t.test('same ID under concurrent handlers dispatches exactly once',async()=>{
    let sends=0;
    const handler=createHandler({env,store,log:()=>{},fetchImpl:async()=>{sends++;return Response.json({ok:true,result:{message_id:99}});}});
    const o=order();const replies=await Promise.all(Array.from({length:20},()=>handler(request(o))));
    assert(replies.every(r=>r.status===200));assert.equal(sends,1);
    const saved=await store.get(o.id);assert.equal(saved.notification.status,'sent');
    assert.equal(await command('TTL',prefix+'order:'+o.id),-1);assert.equal(await command('ZCARD',prefix+'review'),0);
    const changed=await handler(request({...o,contact:{...o.contact,name:'Другой клиент'}}));assert.equal(changed.status,409);assert.equal(sends,1);
  });
  await t.test('phone, IP and global admission limits are atomic; replay still works',async()=>{
    await command('FLUSHDB');
    const record=i=>({fingerprint:'f'+i,order:{id:'order-'+i},receivedAt:Date.now(),mode:'live',notification:{status:'sending'}});
    const results=await Promise.all(Array.from({length:15},(_,i)=>store.admit(record(i),'ip'+i,'same-phone')));
    assert.equal(results.filter(r=>r.kind==='created').length,3);
    const r=results.find(r=>r.kind==='created').record;assert.equal((await store.admit(r,'new-ip','same-phone')).kind,'existing');
    assert.equal((await store.admit({...r,fingerprint:'different'},'ip','phone')).kind,'conflict');
    await command('FLUSHDB');
    const perIP=await Promise.all(Array.from({length:15},(_,i)=>store.admit(record(i),'same-ip','phone'+i)));
    assert.equal(perIP.filter(r=>r.kind==='created').length,10);
    await command('FLUSHDB');
    const global=await Promise.all(Array.from({length:110},(_,i)=>store.admit(record(i),'ip'+i,'phone'+i)));
    assert.equal(global.filter(r=>r.kind==='created').length,100);
    assert((await command('TTL',prefix+'global'))>0);
  });
  await t.test('request limit expires, unresolved claims remain reviewable; finish cannot double-complete',async()=>{
    await command('FLUSHDB');
    const requests=await Promise.all(Array.from({length:65},()=>store.allowRequest('ip')));assert.equal(requests.filter(Boolean).length,60);
    assert((await command('TTL',prefix+'request:ip'))>0);
    const r={fingerprint:'fingerprint',order:{id:'review-id'},receivedAt:Date.now(),mode:'live',notification:{status:'sending'}};
    await store.admit(r,'ip','phone');assert.equal(await command('ZCARD',prefix+'review'),1);
    await store.finish(r,{status:'needs_review',reason:'DELIVERY_UNCERTAIN'});assert.equal(await command('ZCARD',prefix+'review'),1);
    await assert.rejects(()=>store.finish(r,{status:'sent'}));
    const mock=createStore({...env,ORDER_MODE:'mock'},rest);assert.equal(await mock.get(r.order.id),null);
  });
  assert(restCalls>100);
});
test('Redis REST failures, invalid responses and timeouts never retry writes',async()=>{
  for(const impl of [async()=>{throw Error('timeout');},async()=>new Response('bad',{status:503}),async()=>Response.json({error:'secret'}),async()=>Response.json({})]){
    let calls=0;const store=createStore(env,async(...args)=>{calls++;return impl(...args);});await assert.rejects(()=>store.allowRequest('ip'));assert.equal(calls,1);
  }
});
