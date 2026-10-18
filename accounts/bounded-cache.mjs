export class BoundedCache {
  constructor({ bytes = 8 * 1024 * 1024, ttl = 600000, clock = () => Date.now() } = {}) { Object.assign(this, { bytes, ttl, clock }); this.items = new Map(); this.size = 0; }
  delete(key) { const item = this.items.get(key); if (item) this.size -= item.size; this.items.delete(key); }
  get(key) { const item = this.items.get(key); if (!item) return; if (item.expires <= this.clock()) { this.delete(key); return; } this.items.delete(key); this.items.set(key, item); return structuredClone(item.value); }
  set(key, value) { this.delete(key); const size = Buffer.byteLength(JSON.stringify(value)); if (size > this.bytes) return; while (this.size + size > this.bytes) this.delete(this.items.keys().next().value); this.items.set(key, { value: structuredClone(value), size, expires: this.clock() + this.ttl }); this.size += size; }
}
