// Local test server: never contacts Telegram, Vercel, or a remote database.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('.');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png'};
http.createServer(async (req,res) => {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/app'){res.writeHead(308,{Location:'/app/'});res.end();return;}
  if(pathname.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,code:'TEST_SERVER_NO_LIVE_ORDERS'}));return;}
  const name=pathname==='/'?'index.html':pathname==='/app/'?'app/index.html':pathname.slice(1);
  const file=path.resolve(root,name);
  if(!file.startsWith(root+'/') || !['index.html','app'].some(p=>name===p || name.startsWith(p+'/'))){res.writeHead(404);res.end();return;}
  try{const data=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);}
  catch{res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1');
