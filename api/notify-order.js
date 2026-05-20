// Saen — Telegram order notification
// Vercel Edge Function: /api/notify-order
//
// Receives order from PWA, formats it, sends to your Telegram via bot.
// Token stays on server — never exposed to client.
//
// Set these in Vercel project settings → Environment Variables:
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — your chat_id (DM with bot, or group id)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Telegram credentials not configured on server',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let order;
  try {
    order = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Basic validation
  if (!order || !order.id || !order.items || !order.contact) {
    return new Response(JSON.stringify({ ok: false, error: 'Malformed order' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Format the message — Telegram supports HTML or Markdown
  // We use HTML for safety (easier to escape user input)
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
  const prepayment = Math.round(order.total / 2);

  const itemsList = order.items.map((it, i) =>
    `${i + 1}. <b>${esc(it.brand)}</b> · ${esc(it.name)} — <code>${esc(it.priceLabel || fmt(it.price) + ' сум')}</code>`
  ).join('\n');

  const delivery = order.delivery.type === 'pickup'
    ? 'Самовывоз'
    : `Доставка: ${esc(order.delivery.address)}`;

  const emailLine = order.contact.email
    ? `\n✉️ ${esc(order.contact.email)}`
    : '';

  const message = `🆕 <b>Новый предзаказ № ${esc(order.id)}</b>
${esc(order.editFull)}

${itemsList}

💰 <b>Итого: ${fmt(order.total)} сум</b>
   Предоплата 50%: <b>${fmt(prepayment)} сум</b>

👤 <b>${esc(order.contact.name)}</b>
📱 <code>${esc(order.contact.phone)}</code>${emailLine}

📍 ${delivery}

<i>Saen · ${new Date(order.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}</i>`;

  // Send to Telegram
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error('Telegram API error:', tgData);
      return new Response(JSON.stringify({
        ok: false,
        error: 'Telegram delivery failed',
        detail: tgData.description,
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, orderId: order.id }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    console.error('Fetch error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Network error' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
