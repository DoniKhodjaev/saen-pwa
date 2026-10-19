// Local test server. All order responses are fixtures; no remote requests or credentials.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('.');
const events = new Map(); const attempts = new Map();
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png'};
http.createServer(async (req,res) => {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const cookies=Object.fromEntries((req.headers.cookie || '').split(';').map(s=>s.trim().split('=')));
  const session=cookies['saen-test-session'];const mode=cookies['saen-test-mode'];
  const json=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(pathname==='/__test/events'){json(200,events.get(session) || []);return;}
  if(cookies['saen-test-offline']==='1'){res.destroy();return;}
  if(pathname==='/api/notify-order' && req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){json(413,{ok:false});return;}}
    if(!session || !['success','lost','conflict'].includes(mode)){json(503,{ok:false,code:'TEST_SERVER_NO_LIVE_ORDERS'});return;}
    const order=JSON.parse(body);const log=events.get(session) || [];log.push(order);events.set(session,log);
    if(mode==='conflict'){json(409,{ok:false,code:'CATALOG_CHANGED'});return;}
    const key=session+':'+order.id;const n=(attempts.get(key)||0)+1;attempts.set(key,n);
    if(mode==='lost' && n===1){
      // Break after headers/body begin: browsers may transparently replay a POST if nothing was received.
      res.writeHead(200,{'content-type':'application/json','content-length':'500'});res.flushHeaders();res.write('{"ok":');
      setTimeout(()=>res.destroy(),25);return;
    }
    json(200,{ok:true,accepted:true,orderId:order.id,total:order.total,notification:'sent',mode:'live'});return;
  }
  if(pathname.startsWith('/api/')){json(405,{ok:false});return;}
  if(pathname==='/app'){res.writeHead(308,{Location:'/app/'});res.end();return;}
  const name=pathname==='/'?'index.html':pathname==='/app/'?'app/index.html':pathname.slice(1);
  const file=path.resolve(root,name);
  if(!file.startsWith(root+'/') || !['index.html','app'].some(p=>name===p || name.startsWith(p+'/'))){res.writeHead(404);res.end();return;}
  try{let data=await readFile(file);if(name.endsWith('.html'))data=Buffer.from(data.toString().replace(/<link[^>]*https:\/\/fonts\.[^>]*>/g,''));
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);}
  catch{res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1');
