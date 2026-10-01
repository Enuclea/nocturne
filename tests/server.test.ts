import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import { app, parseEphemerisInput, parseTle } from '../server/index.js';
import { clientKey, createLimiter } from '../server/rateLimit.js';
import { interpolateSample, nextRise, parseHorizons, type Sample } from '../server/horizons.js';

const valid = { id: '1;', lat: '40.7128', lon: '-74.006', elevation: '10', time: '2026-09-30T22:00:00Z' };
test('validates topocentric input and rejects malformed coordinates and commands', () => {
  assert.equal(parseEphemerisInput(valid).latitude, 40.7128);
  for (const input of [{ ...valid, lat: '' }, { ...valid, lat: '91' }, { ...valid, lon: 'NaN' }, { ...valid, elevation: '999999' }, { ...valid, id: "1;'&x=y" }, { ...valid, time: '2026-09-30T22:00' }, { ...valid, time: '1800-09-30T22:00:00Z' }]) {
    assert.throws(() => parseEphemerisInput(input));
  }
});

test('parses real Horizons CSV including missing comet magnitudes', () => {
  const samples = parseHorizons(`NASA/JPL\n$$SOE\n 2026-Sep-30 22:00,*, ,107.11279,23.21214,338.173836,-22.960595,8.669,6.888,2.62776092288133,-23.88,\n 2026-Sep-30 22:05,*, ,107.11400,23.21214,339.4,-23.5,n.a.,n.a.,2.6,-23.88,\n$$EOE\nfooter`);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].time, Date.parse('2026-09-30T22:00:00Z'));
  assert.ok(Math.abs(samples[0].ra - 107.11279 / 15) < 1e-10);
  assert.equal(samples[1].magnitude, null);
  assert.throws(() => parseHorizons('No ephemeris is available.'));
});
const sample = (time: number, azimuth: number, altitude: number): Sample => ({ time, ra: 23.99, dec: 20, azimuth, altitude, magnitude: 8, distance: 2 });
test('ephemeris interpolation crosses north without jumping south', () => {
  const middle = interpolateSample(sample(0, 359, 20), { ...sample(1000, 1, 20), ra: 0.01 }, 500);
  assert.ok(middle.azimuth < 0.001 || middle.azimuth > 359.999);
  assert.ok(middle.ra < 0.001 || middle.ra > 23.999);
  assert.ok(Math.abs(middle.altitude - 20) < 0.01);
});
test('rise estimate reports only the next future upward horizon crossing', () => {
  const samples = [sample(0, 88, -2), sample(1000, 90, 2), sample(2000, 270, -2), sample(3000, 88, -2), sample(4000, 90, 2)];
  assert.equal(nextRise(samples, 0)?.time, new Date(500).toISOString());
  assert.equal(nextRise(samples, 600)?.time, new Date(3500).toISOString());
  assert.equal(nextRise(samples, 4000), null);
});
test('TLE parser keeps matching line pairs and rejects upstream HTML', () => {
  const tle = 'ISS (ZARYA)\r\n1 25544U 98067A   26273.50000000  .00016717  00000+0  30218-3 0  9990\r\n2 25544  51.6400 100.0000 0005000  20.0000 340.0000 15.50000000123450\r\n';
  const parsed = parseTle(tle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'ISS (ZARYA)');
  assert.deepEqual(parseTle('<html>Access denied</html>'), []);
});

test('rate limiter allows a fixed number per window, then resets', () => {
  let now = 0;
  const check = createLimiter(3, 60_000, () => now);
  assert.deepEqual([1, 2, 3, 4].map(() => check('a').allowed), [true, true, true, false]);
  assert.equal(check('a').retryAfter, 60);
  assert.equal(check('b').allowed, true);
  now = 60_000;
  assert.equal(check('a').allowed, true);
});

test('client key trusts Cloudflare only when enabled, and groups IPv6 by /64', () => {
  const req = (remoteAddress: string, cf?: string) => ({ headers: cf ? { 'cf-connecting-ip': cf } : {}, socket: { remoteAddress } }) as unknown as Request;
  const previous = process.env.TRUST_CLOUDFLARE;
  try {
    delete process.env.TRUST_CLOUDFLARE;
    assert.equal(clientKey(req('::ffff:172.18.0.3', '203.0.113.9')), '172.18.0.3');
    process.env.TRUST_CLOUDFLARE = 'true';
    assert.equal(clientKey(req('172.18.0.3', '203.0.113.9')), '203.0.113.9');
    assert.equal(clientKey(req('172.18.0.3', '2001:db8:aa:bb:1:2:3:4')), clientKey(req('172.18.0.3', '2001:db8:aa:bb::9')));
    assert.notEqual(clientKey(req('172.18.0.3', '2001:db8:aa:bb::9')), clientKey(req('172.18.0.3', '2001:db8:aa:cc::9')));
  } finally {
    if (previous === undefined) delete process.env.TRUST_CLOUDFLARE; else process.env.TRUST_CLOUDFLARE = previous;
  }
});

test('API routes return 429 with Retry-After past the allowance; health is never limited', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
    // A one-letter city query is rejected locally, so no upstream call is made.
    const statuses = [];
    for (let i = 0; i < 16; i++) statuses.push((await get('/api/geocode?q=x')).status);
    assert.deepEqual(statuses, [...Array(15).fill(400), 429]);
    const limited = await get('/api/geocode?q=x');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.match((await limited.json()).error, /Too many city searches/);
    for (let i = 0; i < 40; i++) assert.equal((await get('/api/health')).status, 200);
  } finally { server.close(); }
});
