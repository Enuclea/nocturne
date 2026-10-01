import type { NextFunction, Request, Response } from 'express';

const MAX_TRACKED = 10_000;

/** Fixed-window counter per key. Memory stays bounded under address-rotating floods. */
export function createLimiter(limit: number, windowMs: number, now = () => Date.now()) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string) => {
    const time = now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= time) {
      if (hits.size >= MAX_TRACKED) {
        for (const [tracked, value] of hits) if (value.reset <= time) hits.delete(tracked);
        // Still full: forget the oldest windows rather than grow without limit.
        for (const tracked of hits.keys()) { if (hits.size < MAX_TRACKED * 0.9) break; hits.delete(tracked); }
      }
      entry = { count: 0, reset: time + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.reset - time) / 1000)) };
  };
}

/** IPv6 visitors usually control a whole /64, so they share one allowance. */
function addressKey(address: string) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.slice(0, 4).map(group => group.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/**
 * Behind Cloudflare every request arrives from Cloudflare (or a local tunnel), so the visitor's
 * address comes from CF-Connecting-IP. Only trust it when the origin is reachable solely through
 * Cloudflare; otherwise anyone could send the header and pick their own allowance.
 */
export function clientKey(req: Request) {
  const forwarded = req.headers['cf-connecting-ip'];
  if (process.env.TRUST_CLOUDFLARE === 'true' && typeof forwarded === 'string' && forwarded.trim()) return addressKey(forwarded.trim());
  return addressKey(req.socket.remoteAddress || 'unknown');
}

export function rateLimit(limit: number, windowMs = 60_000, message = 'Too many requests. Please wait a minute and try again.') {
  const check = createLimiter(limit, windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    const { allowed, retryAfter } = check(clientKey(req));
    if (allowed) { next(); return; }
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: message });
  };
}
