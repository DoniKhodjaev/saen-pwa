// Durable per-order outbox. Never remove an order because a network request failed.
(() => {
  const PREFIX = 'saen-order-v2:';
  function create({ storage = { get length() { return globalThis.localStorage.length; }, key:i => globalThis.localStorage.key(i), getItem:k => globalThis.localStorage.getItem(k), setItem:(k,v) => globalThis.localStorage.setItem(k,v) }, fetchImpl = fetch, now = Date.now, online = () => navigator.onLine, changed = () => {} } = {}) {
    let running = null;
    function list() {
      const entries = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        // Keep corrupted data intact for recovery; don't replace it with an empty array.
        try {
          const entry = JSON.parse(storage.getItem(key));
          if (entry?.order?.id && key === PREFIX + entry.order.id && ['queued','accepted','blocked'].includes(entry.sync?.status)) {
            SaenSchema.parse(entry.order, now());
            entries.push(entry);
          }
        } catch { /* invalid record preserved, never submitted */ }
      }
      return entries.sort((a,b) => a.order.createdAt - b.order.createdAt);
    }
    function put(entry) {
      const raw = JSON.stringify(entry);
      storage.setItem(PREFIX + entry.order.id, raw);
      if (storage.getItem(PREFIX + entry.order.id) !== raw) throw new Error('STORAGE_UNAVAILABLE');
    }
    function add(order) {
      const normalized = SaenSchema.parse(order, now());
      if (storage.getItem(PREFIX + normalized.id)) throw new Error('DUPLICATE_LOCAL_ID');
      put({ order:normalized, sync:{ status:'queued', attempts:0, nextAttempt:0 } });
      changed();
      return normalized;
    }
    async function send(entry) {
      if (!online() || ['accepted','blocked'].includes(entry.sync.status) || entry.sync.nextAttempt > now()) return;
      // Persist the next-attempt marker BEFORE dispatch, so closing/reloading doesn't lose pending work.
      entry.sync.attempts++;
      entry.sync.nextAttempt = now() + Math.min(3600000, 5000 * 2 ** Math.min(entry.sync.attempts, 9));
      put(entry);
      let response, data;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          response = await fetchImpl('/api/notify-order', {
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body:JSON.stringify(entry.order), signal:controller.signal, credentials:'same-origin',
          });
          data = await response.json().catch(() => ({}));
        } finally { clearTimeout(timer); }
        if (response.ok && data.ok === true && data.accepted === true && data.orderId === entry.order.id && data.total === entry.order.total) {
          entry.sync = { ...entry.sync, status:'accepted', notification:data.notification, mode:data.mode, code:null };
        } else if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408) {
          entry.sync.status = 'blocked'; entry.sync.code = data.code || 'INVALID_ORDER';
        } else {
          entry.sync.code = data.code || 'TEMPORARY_FAILURE';
          const seconds = Number(response.headers.get('retry-after'));
          if (Number.isFinite(seconds) && seconds > 0) entry.sync.nextAttempt = now() + Math.min(seconds * 1000, 3600000);
        }
      } catch { entry.sync.code = 'NETWORK_ERROR'; }
      // Another tab may have received a successful acknowledgement while this tab was offline.
      const current = JSON.parse(storage.getItem(PREFIX + entry.order.id) || 'null');
      if (current?.sync?.status === 'accepted') return;
      put(entry);
      changed();
    }
    function flush() {
      if (running) return running;
      running = (async () => {
        for (const entry of list()) await send(entry); // bounded, serial; no retry storm
      })().finally(() => { running = null; });
      return running;
    }
    return { list, add, flush };
  }
  globalThis.SaenOrders = Object.freeze({ create, PREFIX });
})();
