import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { METEOR_SHOWERS, activeShowers, nextShower, peakDate, peakLabel } from '../src/lib/meteorShowers';
import type { ObserverLocation, StarRecord } from '../src/types';

const ny: ObserverLocation = { name: 'New York', latitude: 40.7128, longitude: -74.006, elevation: 10, timezone: 'America/New_York' };
const shower = (id: string) => METEOR_SHOWERS.find(x => x.id === id)!;
const hoursFrom = (a: Date, b: string) => Math.abs(a.getTime() - Date.parse(b)) / 3_600_000;

test('peaks follow solar longitude to the published 2026 dates', () => {
  // IMO 2026 calendar: Perseids Aug 12–13, Geminids Dec 14, Quadrantids Jan 3.
  assert.ok(hoursFrom(peakDate(shower('perseids'), new Date('2026-07-01Z')), '2026-08-12T20:00Z') < 12);
  assert.ok(hoursFrom(peakDate(shower('geminids'), new Date('2026-11-01Z')), '2026-12-14T07:00Z') < 12);
  assert.ok(hoursFrom(peakDate(shower('quadrantids'), new Date('2025-12-20Z')), '2026-01-03T16:00Z') < 12);
});

test('showers are active only inside their window', () => {
  const ids = (iso: string) => activeShowers(new Date(iso), ny).map(x => x.shower.id);
  assert.ok(ids('2026-08-01T06:00Z').includes('perseids'));
  assert.ok(!ids('2026-09-01T06:00Z').includes('perseids'));
  assert.ok(ids('2026-12-14T06:00Z').includes('geminids'));
  assert.deepEqual(ids('2026-03-01T06:00Z'), []);
});

test('the Perseid radiant is high in the northeast before dawn at peak', () => {
  const perseids = activeShowers(new Date('2026-08-13T08:00Z'), ny).find(x => x.shower.id === 'perseids')!;
  assert.ok(perseids.altitude > 50, `altitude ${perseids.altitude}`);
  assert.ok(perseids.azimuth > 0 && perseids.azimuth < 90, `azimuth ${perseids.azimuth}`);
  assert.ok(perseids.strength > 0.8);
});

test('every guide star exists in the catalog and sits near its radiant', () => {
  const stars = new Map((JSON.parse(readFileSync('public/data/stars.json', 'utf8')) as StarRecord[]).map(x => [x.name, x]));
  const r = Math.PI / 180;
  for (const s of METEOR_SHOWERS) for (const name of s.guides) {
    const star = stars.get(name);
    assert.ok(star, `${s.name}: missing guide ${name}`);
    const a = star.ra * 15 * r, d = star.dec * r, b = s.ra * r, e = s.dec * r;
    const separation = Math.acos(Math.sin(d) * Math.sin(e) + Math.cos(d) * Math.cos(e) * Math.cos(a - b)) / r;
    assert.ok(separation < 25, `${s.name}: ${name} is ${separation.toFixed(1)}° from the radiant`);
  }
});

test('next shower and peak labels', () => {
  assert.equal(nextShower(new Date('2026-10-01T12:00Z')).shower.id, 'draconids');
  assert.equal(peakLabel(-2.6), 'Peak in 3 days');
  assert.equal(peakLabel(0.2), 'Peak tonight');
  assert.equal(peakLabel(1), 'Peaked 1 day ago');
});
