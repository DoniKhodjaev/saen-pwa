// Shared structural validation. Prices are checked separately against the server catalog.
(() => {
  class OrderError extends Error {
    constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
  }
  const fail = (code = 'INVALID_ORDER', status = 400) => { throw new OrderError(code, status); };
  const object = (v, keys) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail();
  };
  const text = (v, min, max) => {
    if (typeof v !== 'string' || v.length > max || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(v)) fail();
    const s = v.trim();
    if (s.length < min) fail();
    return s;
  };
  const money = v => {
    if (!Number.isSafeInteger(v) || v <= 0 || v > 100000000) fail();
    return v;
  };
  function parse(input, now = Date.now()) {
    object(input, ['id', 'catalogVersion', 'items', 'total', 'contact', 'delivery', 'createdAt']);
    if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id)) fail();
    const catalogVersion = text(input.catalogVersion, 1, 64);
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < Date.UTC(2026, 0, 1) || input.createdAt > now + 300000) fail();
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 7) fail();
    const seen = new Set();
    const items = input.items.map(it => {
      object(it, ['n', 'price']);
      const n = text(it.n, 1, 12);
      if (seen.has(n)) fail();
      seen.add(n);
      return { n, price: money(it.price) };
    }).sort((a,b) => a.n.localeCompare(b.n));
    object(input.contact, ['name', 'phone', 'email']);
    const name = text(input.contact.name, 2, 80);
    const rawPhone = text(input.contact.phone, 9, 24);
    if (!/^\+?[\d ()-]+$/.test(rawPhone)) fail();
    let phone = rawPhone.replace(/[ ()-]/g, '').replace(/^\+/, '');
    if (phone.length === 9) phone = '998' + phone;
    if (!/^998\d{9}$/.test(phone)) fail();
    const email = text(input.contact.email ?? '', 0, 120);
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail();
    object(input.delivery, ['type', 'address']);
    const type = input.delivery.type;
    if (!['pickup', 'delivery'].includes(type)) fail();
    const address = type === 'delivery' ? text(input.delivery.address, 5, 240) : null;
    if (type === 'pickup' && input.delivery.address != null && input.delivery.address !== '') fail();
    return { id: input.id, catalogVersion, items, total: money(input.total),
      contact: { name, phone: '+' + phone, email }, delivery: { type, address }, createdAt: input.createdAt };
  }
  globalThis.SaenSchema = Object.freeze({ parse, OrderError, fail });
})();
