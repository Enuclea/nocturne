import express from 'express';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cached, remoteJson, remoteText } from './cache.js';
import { catalog } from './catalog.js';
import { rateLimit } from './rateLimit.js';
import { getEphemeris, searchSmallBodies } from './horizons.js';
import type { ObserverLocation, SatelliteRecord } from '../src/types.js';

export const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', application: 'Nocturne', version: '1.0.0' }));
// Per-visitor allowances. A normal session makes a handful of API calls a minute; the routes
// that can reach public upstreams are tighter. cache.ts also caps fresh upstream calls overall.
app.use('/api', rateLimit(120));
app.get('/api/catalog', (_req, res) => res.json({ objects: catalog }));

app.get('/api/geocode', rateLimit(15, 60_000, 'Too many city searches. Please wait a minute and try again.'), async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 120) { res.status(400).json({ error: 'Enter a city name between 2 and 120 characters.' }); return; }
  try {
    const results = await cached(`geocode:${query.toLowerCase()}`, 7 * 24 * 3600_000, async () => {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' }).toString();
      const data = await remoteJson<{ results?: { name: string; latitude: number; longitude: number; elevation?: number; timezone?: string; admin1?: string; country?: string }[] }>(url);
      return (data.results || []).map(item => ({ name: [item.name, item.admin1 !== item.name ? item.admin1 : '', item.country].filter(Boolean).join(', '), latitude: item.latitude, longitude: item.longitude, elevation: item.elevation || 0, timezone: item.timezone || 'UTC' } as ObserverLocation));
    });
    res.json({ results, source: 'Open-Meteo / GeoNames' });
  } catch { res.status(502).json({ error: 'City search is temporarily unavailable. You can still enter latitude, longitude.' }); }
});

app.get('/api/search', rateLimit(10, 60_000, 'Too many NASA searches. Please wait a minute and try again.'), async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 80 || !/^[\p{L}\p{N}\s/.'()-]+$/u.test(query)) { res.status(400).json({ error: 'Enter an object name or designation (2–80 characters).' }); return; }
  try { res.json({ objects: await searchSmallBodies(query) }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'The NASA/JPL catalog is unavailable.' }); }
});

export function parseEphemerisInput(query: Record<string, unknown>) {
  const numeric = (key: string, min: number, max: number, fallback?: number) => {
    const raw = query[key];
    if ((raw === undefined || raw === '') && fallback !== undefined) return fallback;
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`Missing ${key}.`);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}.`);
    return value;
  };
  const latitude = numeric('lat', -90, 90), longitude = numeric('lon', -180, 180), elevation = numeric('elevation', -500, 10_000, 0);
  const id = typeof query.id === 'string' ? query.id : '';
  if (!catalog.some(item => item.id === id) && !/^DES=\d{1,12};$/.test(id)) throw new Error('Invalid object identifier.');
  if (typeof query.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(query.time)) throw new Error('Use an ISO date and time with a time zone.');
  const date = new Date(query.time);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2100) throw new Error('Choose a date between 1900 and 2100.');
  return { id, latitude, longitude, elevation, date };
}
app.get('/api/ephemeris', rateLimit(40, 60_000, 'Too many position requests. Please wait a minute and try again.'), async (req, res) => {
  let input: ReturnType<typeof parseEphemerisInput>;
  try { input = parseEphemerisInput(req.query); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid observer or date.' }); return; }
  try { res.json(await getEphemeris(input.id, input.latitude, input.longitude, input.elevation, input.date)); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'NASA/JPL is temporarily unavailable.' }); }
});

export function parseTle(text: string): SatelliteRecord[] {
  const lines = text.trim().split(/\r?\n/).map(line => line.trimEnd());
  const satellites: SatelliteRecord[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      if (lines[i + 1].length >= 69 && lines[i + 2].length >= 69) satellites.push({ name: lines[i].replace(/^0 /, '').trim(), line1: lines[i + 1], line2: lines[i + 2] });
      i += 2;
    }
  }
  return satellites;
}
app.get('/api/satellites', async (_req, res) => {
  const result = await cached('visual-satellites-v1', 2 * 3600_000, async () => {
    try {
      const raw = await remoteText('https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle');
      const satellites = parseTle(raw);
      if (!satellites.length) throw new Error('No orbital elements returned.');
      return { satellites, fetchedAt: new Date().toISOString(), source: 'CelesTrak visual satellites' };
    } catch {
      return { satellites: [] as SatelliteRecord[], fetchedAt: null, warning: 'CelesTrak is unavailable. Satellite positions cannot be calculated until fresh orbital elements are available.' };
    }
  });
  res.json(result);
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
const dist = resolve(process.cwd(), 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error instanceof Error ? error.message : 'Unexpected server error');
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const server = app.listen(port, '0.0.0.0', () => console.log(`Nocturne listening on http://localhost:${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
