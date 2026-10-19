import '../app/catalog.js';
import '../app/order-schema.js';
export const catalog = globalThis.SaenCatalog;
export const { parse, OrderError } = globalThis.SaenSchema;
export function priceOrder(intent) {
  if (intent.catalogVersion !== catalog.version) throw new OrderError('CATALOG_CHANGED', 409);
  const items = intent.items.map(it => {
    const p = catalog.products.find(p => p.n === it.n);
    if (!p) throw new OrderError('UNKNOWN_PRODUCT', 400);
    if (it.price !== p.priceUzs) throw new OrderError('PRICE_CHANGED', 409);
    return { n: p.n, brand: p.brand, name: p.name, size: p.size, price: p.priceUzs };
  });
  const deliveryFee = intent.delivery.type === 'delivery' ? catalog.deliveryFeeUzs : 0;
  const total = items.reduce((sum, it) => sum + it.price, deliveryFee);
  if (total !== intent.total) throw new OrderError('TOTAL_MISMATCH', 409);
  return { ...intent, items, total, deliveryFee, editFull: catalog.edit };
}
export async function digest(value, secret) {
  const bytes = new TextEncoder().encode(value);
  let hash;
  if (secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
    hash = await crypto.subtle.sign('HMAC', key, bytes);
  } else hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt = n => n.toLocaleString('ru-RU');
export function telegramMessage(order, receivedAt) {
  return `🆕 <b>Предзаказ № ${order.id}</b>\n${esc(order.editFull)}\n\n` +
    order.items.map((it,i) => `${i+1}. <b>${esc(it.brand)}</b> · ${esc(it.name)} · ${esc(it.size)} — ${fmt(it.price)} сум`).join('\n') +
    `\n\n💰 <b>Итого: ${fmt(order.total)} сум</b>\nПредоплата 50%: ${fmt(Math.round(order.total/2))} сум\n` +
    `\n👤 ${esc(order.contact.name)}\n📱 ${esc(order.contact.phone)}` +
    (order.contact.email ? `\n✉️ ${esc(order.contact.email)}` : '') +
    `\n📍 ${order.delivery.type === 'pickup' ? 'Самовывоз' : esc(order.delivery.address)}` +
    `\n\nSaen · ${new Date(receivedAt).toLocaleString('ru-RU', { timeZone:'Asia/Tashkent' })}`;
}
