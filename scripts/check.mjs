import { readFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import '../app/catalog.js';
for (const dir of ['api','lib','app']) {
  for (const name of await readdir(dir)) if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', `${dir}/${name}`]);
}
for (const file of ['index.html','app/index.html']) {
  const html = await readFile(file,'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename:file });
}
const app = await readFile('app/index.html','utf8');
assert(app.includes('href="/app/manifest.json"'));
assert(app.includes("register('/app/sw.js'"));
const manifest = JSON.parse(await readFile('app/manifest.json','utf8'));
assert.equal(manifest.start_url, '/app/'); assert.equal(manifest.scope, '/app/');
// The landing page still has richer editorial copy; verify its quoted prices agree.
const landing = await readFile('index.html','utf8');
const landingPrices = [...landing.matchAll(/price: '~([\d ]+) сум'/g)].map(m => Number(m[1].replaceAll(' ','')));
assert.deepEqual(landingPrices, SaenCatalog.products.map(p => p.priceUzs));
await rm('public', { recursive:true, force:true });
await mkdir('public', { recursive:true });
await cp('index.html','public/index.html');
await cp('app','public/app', { recursive:true });
console.log('Syntax, manifest, catalog/landing prices and isolated static build: OK');
