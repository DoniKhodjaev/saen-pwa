// Read-only operational check. No Telegram calls, order mutations, or customer PII in output.
const {UPSTASH_REDIS_REST_URL:url,UPSTASH_REDIS_REST_TOKEN:token,ORDER_MODE:mode}=process.env;
if(!url?.startsWith('https://')||!token||!['live','mock'].includes(mode))throw Error('Set Redis credentials and ORDER_MODE');
async function command(...args){
  const res=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(4000)});
  if(!res.ok)throw Error('Redis unavailable');const data=await res.json();if(data.error)throw Error('Redis command failed');return data.result;
}
const prefix=`saen:{orders}:${mode}:`;
const ids=await command('ZRANGE',prefix+'review',0,99);
for(const id of ids){const raw=await command('GET',prefix+'order:'+id);if(!raw)continue;const r=JSON.parse(raw);
  console.log(JSON.stringify({id:r.order.id,receivedAt:new Date(r.receivedAt).toISOString(),notification:r.notification}));
}
console.log(JSON.stringify({unresolved:await command('ZCARD',prefix+'review'),displayed:ids.length}));
