import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createLimiter } from './rateLimit.js';

const directory = process.env.CACHE_DIR || join(process.cwd(), '.cache');
const memory = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();

/** Disk-backed cache survives container restarts. Concurrent identical requests coalesce. */
export async function cached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const work = (async () => {
    const path = join(directory, createHash('sha256').update(key).digest('hex') + '.json');
    try {
      const disk = JSON.parse(await readFile(path, 'utf8'));
      if (disk.expires > Date.now()) { remember(key, disk); return disk.value as T; }
    } catch { /* A cold cache is expected. */ }
    const value = await fetcher();
    const record = { expires: Date.now() + ttl, value };
    remember(key, record);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(path + '.tmp', JSON.stringify(record));
      await rename(path + '.tmp', path);
    } catch { /* Read-only installations still have a working memory cache. */ }
    return value;
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
function remember(key: string, record: { expires: number; value: unknown }) {
  if (memory.size >= 160) memory.delete(memory.keys().next().value!);
  memory.set(key, record);
}

// NASA requests must be sequential across all endpoints, even across visitors.
let nasaQueue: Promise<unknown> = Promise.resolve();
let nasaBackoffUntil = 0;
export function nasaRequest<T>(task: () => Promise<T>): Promise<T> {
  const result = nasaQueue.then(async () => {
    if (Date.now() < nasaBackoffUntil) throw new Error('NASA/JPL is temporarily unavailable. Please try again in a few minutes.');
    try { return await task(); }
    catch (error) { nasaBackoffUntil = Date.now() + 60_000; throw error; }
  });
  nasaQueue = result.catch(() => undefined);
  return result;
}

// Fresh (uncached) calls per upstream host per minute, across all visitors. This holds even if
// requests arrive from many addresses, so a flood cannot get this server blocked upstream.
const UPSTREAM_BUDGET: Record<string, number> = { 'ssd.jpl.nasa.gov': 30, 'ssd-api.jpl.nasa.gov': 30, 'celestrak.org': 10 };
const upstreamLimiters = new Map<string, ReturnType<typeof createLimiter>>();
function withinUpstreamBudget(host: string) {
  let limiter = upstreamLimiters.get(host);
  if (!limiter) { limiter = createLimiter(UPSTREAM_BUDGET[host] ?? 60, 60_000); upstreamLimiters.set(host, limiter); }
  return limiter('all').allowed;
}

export async function remoteText(url: URL | string): Promise<string> {
  if (!withinUpstreamBudget(new URL(url).hostname)) throw new Error('Nocturne is busy right now. Please try again in a minute.');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: { 'User-Agent': process.env.JPL_USER_AGENT || 'Nocturne/1.0 (personal local observatory; http://localhost:3001)', Accept: 'application/json, text/plain' },
  });
  if (!response.ok) throw new Error(`The public data service returned HTTP ${response.status}. Please try again later.`);
  const body = await response.text();
  if (body.length > 12_000_000) throw new Error('The public data response is unexpectedly large.');
  return body;
}
export async function remoteJson<T>(url: URL | string): Promise<T> {
  try { return JSON.parse(await remoteText(url)) as T; }
  catch (error) { if (error instanceof SyntaxError) throw new Error('The public data service returned an unreadable response.'); throw error; }
}
