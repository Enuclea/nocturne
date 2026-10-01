import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  cardinalDirection, computeSatellites, computeSky, equatorialToHorizontal, getMoonPhase,
  getRiseEvent, getSunAltitude, getVisibility, isSatelliteSunlit, modeMagnitudeLimit,
} from '../src/lib/astronomy';
import type { ObserverLocation, SatelliteRecord, SkyObject, StarRecord } from '../src/types';

const ny: ObserverLocation = { name: 'New York', latitude: 40.7128, longitude: -74.006, elevation: 10, timezone: 'America/New_York' };
const find = (sky: SkyObject[], id: string) => { const o = sky.find(x => x.id === id); assert.ok(o, `Missing ${id}`); return o; };
const separation = (a: SkyObject, b: SkyObject) => {
  const r = Math.PI / 180;
  return Math.acos(Math.min(1, Math.sin(a.altitude * r) * Math.sin(b.altitude * r) + Math.cos(a.altitude * r) * Math.cos(b.altitude * r) * Math.cos((a.azimuth - b.azimuth) * r))) / r;
};

test('topocentric Sun and Moon reproduce the 2024 Dallas eclipse alignment', () => {
  // Independent observed event: NASA reports Dallas totality at 13:40–13:44 CDT.
  // https://science.nasa.gov/eclipses/future-eclipses/eclipse-2024/telescope-feeds/
  const dallas = { ...ny, name: 'Dallas', latitude: 32.7767, longitude: -96.797, elevation: 130 };
  const date = new Date('2024-04-08T18:42:00Z');
  const sky = computeSky(date, dallas, []);
  const sun = find(sky, 'sun'), moon = find(sky, 'moon');
  assert.ok(separation(sun, moon) < 0.03, 'Sun and Moon centers should nearly coincide');
  assert.ok(sun.altitude > 64 && sun.altitude < 66);
  assert.ok(sun.azimuth > 180 && sun.azimuth < 195);
  assert.ok(getMoonPhase(date) < 0.001);
  assert.ok(Math.abs(getSunAltitude(date, dallas) - sun.altitude) < 0.0001);
});

test('solar direction, longitude sign and seasonal altitude are correct', () => {
  const greenwich = { ...ny, latitude: 51.4779, longitude: 0, elevation: 0 };
  const equinoxNoon = getSunAltitude(new Date('2025-03-20T12:00:00Z'), greenwich);
  assert.ok(equinoxNoon > 38 && equinoxNoon < 40);
  assert.ok(getSunAltitude(new Date('2025-03-20T00:00:00Z'), greenwich) < -37);
  const west = { ...ny, latitude: 0, longitude: -90 };
  const east = { ...ny, latitude: 0, longitude: 90 };
  assert.ok(getSunAltitude(new Date('2025-03-20T06:00:00Z'), east) > 85);
  assert.ok(getSunAltitude(new Date('2025-03-20T06:00:00Z'), west) < -85);
});

test('J2000 conversion preserves the pole and eastern rising direction', () => {
  const date = new Date('2026-09-30T02:00:00Z');
  const polaris = equatorialToHorizontal(2.530301, 89.264109, date, ny);
  assert.ok(Math.abs(polaris.altitude - ny.latitude) < 1);
  assert.ok(Math.min(polaris.azimuth, 360 - polaris.azimuth) < 1.5);
  const south = equatorialToHorizontal(2.530301, 89.264109, date, { ...ny, latitude: -40 });
  assert.ok(south.altitude < -39);
});

test('next rise is in the future, crosses the horizon, and handles circumpolar stars', () => {
  const date = new Date('2025-06-21T04:00:00Z'), sky = computeSky(date, ny, []);
  const sunrise = getRiseEvent(find(sky, 'sun'), date, ny);
  assert.ok(sunrise);
  assert.ok(Math.abs(Date.parse(sunrise.time) - Date.parse('2025-06-21T09:25:00Z')) < 180_000);
  assert.ok(sunrise.azimuth > 55 && sunrise.azimuth < 60);
  const sirius = sky.find(s => s.name === 'Sirius')!;
  const rise = getRiseEvent(sirius, date, ny);
  assert.ok(rise && Date.parse(rise.time) > date.getTime());
  const before = equatorialToHorizontal(sirius.ra, sirius.dec, new Date(Date.parse(rise.time) - 60_000), ny);
  const after = equatorialToHorizontal(sirius.ra, sirius.dec, new Date(Date.parse(rise.time) + 60_000), ny);
  assert.ok(before.altitude < 0 && after.altitude > 0);
  assert.ok(rise.azimuth > 90 && rise.azimuth < 150);
  assert.equal(getRiseEvent(sky.find(s => s.name === 'Polaris')!, date, ny), null);
  const canopus = sky.find(s => s.name === 'Canopus')!;
  assert.equal(getRiseEvent(canopus, date, { ...ny, latitude: 60 }), null);
});

test('planet and Galilean moon positions move with the simulation date', () => {
  const date = new Date('2026-09-30T02:00:00Z');
  const sky = computeSky(date, ny, []), later = computeSky(new Date(date.getTime() + 6 * 3600_000), ny, []);
  for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'moon', 'io', 'europa', 'ganymede', 'callisto']) {
    const object = find(sky, id);
    assert.ok(Number.isFinite(object.altitude) && object.azimuth >= 0 && object.azimuth < 360);
    assert.ok(object.ra >= 0 && object.ra < 24 && Math.abs(object.dec) <= 90);
  }
  assert.ok(Math.abs(find(sky, 'moon').ra - find(later, 'moon').ra) > 0.1);
  assert.notEqual(find(sky, 'io').ra - find(sky, 'jupiter').ra, find(later, 'io').ra - find(later, 'jupiter').ra);
  for (const id of ['io', 'europa', 'ganymede', 'callisto']) assert.ok(separation(find(sky, id), find(sky, 'jupiter')) < 0.2);
});

const iss: SatelliteRecord = {
  name: 'ISS (historical test elements)',
  // The satellite.js README’s public SGP4 example, epoch 2019-06-05.
  line1: '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2: '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

test('satellite propagation rejects old elements and distinguishes sunlight from shadow', () => {
  const current = find(computeSky(new Date('2019-06-05T12:00:00Z'), ny, [], [iss]), 'sat-25544');
  assert.equal(current.available, true);
  assert.ok(Number.isFinite(current.altitude));
  assert.equal(current.observable, false, 'daylight should suppress optical visibility');
  for (const time of ['2019-05-20T00:00:00Z', '2026-09-30T00:00:00Z']) {
    const stale = find(computeSky(new Date(time), ny, [], [iss]), 'sat-25544');
    assert.equal(stale.available, false);
    assert.equal(getRiseEvent(stale, new Date(time), ny, [iss]), null);
    assert.equal(getVisibility(stale, 'telescope', -20).visible, false);
  }
  assert.equal(isSatelliteSunlit({ x: 7000, y: 0, z: 0 }, [1, 0, 0]), true);
  assert.equal(isSatelliteSunlit({ x: -7000, y: 0, z: 0 }, [1, 0, 0]), false);
  assert.equal(isSatelliteSunlit({ x: 0, y: 7000, z: 0 }, [1, 0, 0]), true);
  assert.equal(isSatelliteSunlit({ x: 100, y: 0, z: 0 }, [1, 0, 0]), false);
});

test('satellite pass event has an illuminated satellite above a dark horizon', () => {
  const date = new Date('2019-06-05T12:00:00Z');
  const satellite = find(computeSky(date, ny, [], [iss]), 'sat-25544');
  const pass = getRiseEvent(satellite, date, ny, [iss]);
  assert.ok(pass && pass.kind === 'pass' && Date.parse(pass.time) > date.getTime());
  const atPass = find(computeSky(new Date(pass.time), ny, [], [iss]), satellite.id);
  assert.ok(atPass.altitude > 0 && atPass.observable);
  assert.ok(getSunAltitude(new Date(pass.time), ny) < -6);
});

test('satellite positions advance each second through a visible pass', () => {
  const date = new Date('2019-06-05T12:00:00Z');
  const satellite = find(computeSatellites(date, ny, [iss]), 'sat-25544');
  const pass = getRiseEvent(satellite, date, ny, [iss]);
  assert.ok(pass);
  const start = Date.parse(pass.time) + 60_000;
  let previous = find(computeSatellites(new Date(start), ny, [iss]), satellite.id);
  assert.deepEqual(previous, find(computeSky(new Date(start), ny, [], [iss]), satellite.id));
  for (let second = 1; second <= 5; second++) {
    const next = find(computeSatellites(new Date(start + second * 1000), ny, [iss]), satellite.id);
    assert.ok(next.altitude > 0 && next.observable);
    const motion = separation(previous, next);
    assert.ok(motion > 0.001 && motion < 2, `Expected continuous one-second motion, got ${motion}°`);
    previous = next;
  }
});

test('modes include daylight, horizon and catalog brightness constraints', () => {
  const source = computeSky(new Date('2026-09-30T02:00:00Z'), ny, []).find(x => x.category === 'star')!;
  const star = { ...source, altitude: 45, magnitude: 8 };
  assert.deepEqual(['eye', 'binocular', 'telescope'].map(mode => modeMagnitudeLimit(mode as 'eye')), [6, 9, 12]);
  assert.equal(getVisibility(star, 'eye', -20).visible, false);
  assert.equal(getVisibility(star, 'binocular', -20).visible, true);
  assert.equal(getVisibility(star, 'telescope', 10).visible, false);
  assert.equal(getVisibility({ ...star, altitude: -1 }, 'telescope', -20).visible, false);
  assert.equal(getVisibility({ ...star, magnitude: null }, 'telescope', -20).visible, false);
  assert.deepEqual([0, 90, 180, 270, -90, 360].map(cardinalDirection), ['N', 'E', 'S', 'W', 'W', 'N']);
});

test('bundled public star catalog has real bright stars, valid units and broad coverage', () => {
  const stars: StarRecord[] = JSON.parse(readFileSync(new URL('../public/data/stars.json', import.meta.url), 'utf8'));
  assert.equal(stars.length, 83_479);
  assert.equal(new Set(stars.map(s => s.id)).size, stars.length);
  assert.ok(stars.every(s => s.ra >= 0 && s.ra < 24 && Math.abs(s.dec) <= 90 && s.magnitude <= 9));
  const sirius = stars.find(s => s.name === 'Sirius')!;
  assert.ok(sirius && sirius.magnitude < -1.4 && sirius.ra > 6.7 && sirius.ra < 6.8);
  assert.ok(stars.some(s => s.name === 'Polaris'));
  assert.ok(stars.some(s => s.dec < -89) && stars.some(s => s.dec > 89));
  const sky = computeSky(new Date('2026-09-30T02:00:00Z'), ny, stars);
  assert.equal(sky.filter(s => s.category === 'star').length, stars.length);
  assert.ok(sky.every(s => Number.isFinite(s.altitude) && Number.isFinite(s.azimuth)));
});
