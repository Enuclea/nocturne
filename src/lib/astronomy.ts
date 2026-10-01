import * as A from 'astronomy-engine';
import * as S from 'satellite.js';
import type { ObserverLocation, ObservingMode, RiseEvent, SatelliteRecord, SkyObject, StarRecord } from '../types';
import { BRIGHT_STARS } from './brightStars';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY = 86_400_000;
const AU_KM = 149_597_870.7;
const J2000 = Date.UTC(2000, 0, 1, 12);
const SOURCE = 'Astronomy Engine';
const SOURCE_URL = 'https://github.com/cosinekitty/astronomy';
const STAR_SOURCE = 'HYG v4.1 · Hipparcos / Yale / Gliese';
const STAR_URL = 'https://github.com/astronexus/HYG-Database';
const normalize = (n: number) => ((n % 360) + 360) % 360;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const observerFor = (o: ObserverLocation) => new A.Observer(o.latitude, o.longitude, o.elevation);

const BODIES = [
  [A.Body.Mercury, '#c4bbb1', 'A small, rocky world close to the Sun. Best placed during morning or evening elongations.'],
  [A.Body.Venus, '#fff0c8', 'Earth’s brilliant neighboring planet. A telescope reveals phases as it circles the Sun.'],
  [A.Body.Mars, '#eea47e', 'The red planet. Its apparent size and brightness vary greatly with its distance from Earth.'],
  [A.Body.Jupiter, '#ead1a2', 'Our largest planet. Small telescopes reveal cloud bands and its four Galilean moons.'],
  [A.Body.Saturn, '#e7d7aa', 'A pale golden planet surrounded by rings. Their apparent tilt changes throughout its orbit.'],
  [A.Body.Uranus, '#a2ddd8', 'A distant ice giant with a subtle blue-green hue. Binoculars help identify it among the stars.'],
  [A.Body.Neptune, '#84a9ee', 'The outermost major planet. A telescope reveals a tiny blue disk.'],
  [A.Body.Pluto, '#cabdb0', 'A dwarf planet beyond Neptune. Usually too faint for a small telescope, but its position remains available.'],
  [A.Body.Moon, '#eeeada', 'Earth’s natural satellite. Its phase and topocentric position are calculated for your observing time and location.'],
  [A.Body.Sun, '#ffe9a1', 'Our nearest star, shown as a reference for daylight and twilight. Never view the Sun through unfiltered optics.'],
] as const;
const BODY_BY_ID = new Map<string, A.Body>(BODIES.map(([body]) => [body.toLowerCase(), body]));

type Vec = { x: number; y: number; z: number };
function horizontal(v: Vec, rotation: A.RotationMatrix, refract = true) {
  const r = rotation.rot;
  const x = r[0][0] * v.x + r[1][0] * v.y + r[2][0] * v.z;
  const y = r[0][1] * v.x + r[1][1] * v.y + r[2][1] * v.z;
  const z = r[0][2] * v.x + r[1][2] * v.y + r[2][2] * v.z;
  const altitude = Math.atan2(z, Math.hypot(x, y)) * DEG;
  return { altitude: altitude + (refract ? A.Refraction('normal', altitude) : 0), azimuth: normalize(-Math.atan2(y, x) * DEG) };
}

/** J2000-frame right ascension in HOURS, declination in DEGREES. Azimuth: N=0, E=90. */
export function equatorialToHorizontal(ra: number, dec: number, date: Date, observer: ObserverLocation) {
  const a = ra * 15 * RAD, d = dec * RAD;
  return horizontal({ x: Math.cos(a) * Math.cos(d), y: Math.sin(a) * Math.cos(d), z: Math.sin(d) }, A.Rotation_EQJ_HOR(date, observerFor(observer)));
}

function starColor(bv = 0.5): string {
  if (bv < -0.1) return '#a9c6ff';
  if (bv < 0.25) return '#d5e2ff';
  if (bv < 0.65) return '#f5f1e4';
  if (bv < 1.2) return '#ffddb0';
  return '#ffb88e';
}

interface PreparedStar { record: StarRecord; base: Vec; velocity: Vec; color: string; description: string }
const preparedCatalogs = new WeakMap<StarRecord[], PreparedStar[]>();
function prepareStars(stars: StarRecord[]) {
  let prepared = preparedCatalogs.get(stars);
  if (!prepared) {
    prepared = stars.map(record => {
      const a = record.ra * 15 * RAD, d = record.dec * RAD;
      const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
      // HYG pmra is mu_alpha*cos(delta), in milliarcseconds/year. Tangent vectors avoid polar division.
      const ma = (record.pmra ?? 0) * RAD / 3_600_000;
      const md = (record.pmdec ?? 0) * RAD / 3_600_000;
      return { record, base: { x: ca * cd, y: sa * cd, z: sd }, velocity: { x: -ma * sa - md * ca * sd, y: ma * ca - md * sa * sd, z: md * cd }, color: starColor(record.bv), description: `${record.constellation ? `A catalogued star in ${record.constellation}. ` : ''}Visual magnitude ${record.magnitude.toFixed(2)}. HYG J2000 position with proper motion, precession and nutation; brightness is a catalog estimate.` };
    });
    preparedCatalogs.set(stars, prepared);
  }
  return prepared;
}

function planets(date: Date, observer: ObserverLocation, rotation: A.RotationMatrix): SkyObject[] {
  const at = observerFor(observer);
  return BODIES.map(([body, color, description]) => {
    const eq = A.Equator(body, date, at, false, true);
    const light = A.Illumination(body, date);
    return { id: body.toLowerCase(), name: body, category: body === A.Body.Moon ? 'moon' : 'planet', ...horizontal(eq.vec, rotation), ra: eq.ra, dec: eq.dec, magnitude: light.mag, color, description, distance: body === A.Body.Moon ? `${Math.round(eq.dist * AU_KM).toLocaleString('en-US')} km` : `${eq.dist.toFixed(2)} AU`, phase: light.phase_fraction, source: SOURCE, sourceUrl: SOURCE_URL, available: true };
  });
}

const GALILEANS = [
  ['io', 'Io', 4.9, '#e8c785'], ['europa', 'Europa', 5.3, '#efe0c9'],
  ['ganymede', 'Ganymede', 4.6, '#c8bca8'], ['callisto', 'Callisto', 5.6, '#a9a294'],
] as const;

function jupiterMoons(date: Date, observer: ObserverLocation, rotation: A.RotationMatrix): SkyObject[] {
  const jupiter = A.Equator(A.Body.Jupiter, date, observerFor(observer), false, true);
  // Planet vector already includes light travel time. Evaluate the moons at the same retarded epoch.
  const emittedAt = new A.AstroTime(date).AddDays(-jupiter.dist / A.C_AUDAY);
  const moons = A.JupiterMoons(emittedAt);
  const solar = A.HelioVector(A.Body.Jupiter, emittedAt);
  const solarDistance = solar.Length();
  const j = jupiter.vec, jl = jupiter.dist;
  const radius = 71_492 / AU_KM;
  return GALILEANS.map(([key, name, referenceMagnitude, color]) => {
    const m = moons[key];
    const vector = new A.Vector(j.x + m.x, j.y + m.y, j.z + m.z, new A.AstroTime(date));
    const eq = A.EquatorFromVector(vector);
    const projection = (m.x * j.x + m.y * j.y + m.z * j.z) / jl;
    const separation = Math.sqrt(Math.max(0, m.x * m.x + m.y * m.y + m.z * m.z - projection * projection));
    const hiddenByDisk = separation < radius;
    const behindFromSun = (m.x * solar.x + m.y * solar.y + m.z * solar.z) / solarDistance;
    const shadowOffset = Math.sqrt(Math.max(0, m.x * m.x + m.y * m.y + m.z * m.z - behindFromSun ** 2));
    const inShadow = behindFromSun > 0 && shadowOffset < radius - behindFromSun * (695_700 / AU_KM - radius) / solarDistance;
    const warning = hiddenByDisk ? 'Projected against Jupiter’s disk; not shown as a separate point.' : inShadow ? 'In Jupiter’s shadow; not illuminated.' : 'Telescope target. Brightness is approximate; Jupiter’s glare and seeing affect visibility.';
    return { id: key, name, category: 'moon', ...horizontal(vector, rotation), ra: eq.ra, dec: eq.dec, magnitude: referenceMagnitude + 5 * Math.log10(solarDistance * eq.dist / (5.2 * 4.2)), color, description: `One of Jupiter’s four Galilean moons. Position includes orbital motion and light travel time. Use a small telescope and zoom in around Jupiter; estimated brightness does not model eclipses or phase in detail.`, distance: `${eq.dist.toFixed(2)} AU`, source: SOURCE, sourceUrl: SOURCE_URL, available: true, observable: !hiddenByDisk && !inShadow, warning };
  });
}

const satelliteCache = new WeakMap<SatelliteRecord, S.SatRec>();
function satrecFor(record: SatelliteRecord) {
  let satrec = satelliteCache.get(record);
  if (!satrec) { satrec = S.twoline2satrec(record.line1, record.line2); satelliteCache.set(record, satrec); }
  return satrec;
}

/** Conservative spherical Earth/Sun disk test; penumbra is not counted as fully sunlit. */
export function isSatelliteSunlit(position: Vec, sunAu: number[]): boolean {
  const radius = Math.hypot(position.x, position.y, position.z);
  if (radius <= 6378.137) return false;
  const sun = { x: sunAu[0] * AU_KM - position.x, y: sunAu[1] * AU_KM - position.y, z: sunAu[2] * AU_KM - position.z };
  const length = Math.hypot(sun.x, sun.y, sun.z);
  const angle = Math.acos(clamp((-position.x * sun.x - position.y * sun.y - position.z * sun.z) / (radius * length), -1, 1));
  return angle > Math.asin(6378.137 / radius) + Math.asin(695_700 / length);
}

function satelliteObject(record: SatelliteRecord, date: Date, observer: ObserverLocation, sunAltitude: number, sunVector?: number[]): SkyObject {
  const satrec = satrecFor(record);
  const epoch = new Date((satrec.jdsatepoch - 2440587.5) * DAY);
  const id = `sat-${satrec.satnum}`;
  const base = { id, name: record.name, category: 'satellite' as const, altitude: NaN, azimuth: NaN, ra: NaN, dec: NaN, magnitude: null, color: '#bce5df', description: 'SGP4 orbit from public CelesTrak elements. Positions are predictions; no brightness or flare model is available. A sunlit pass in darkness is only potentially visible.', source: 'CelesTrak · SGP4 / satellite.js', sourceUrl: 'https://celestrak.org/NORAD/elements/', epoch: Number.isFinite(epoch.getTime()) ? epoch.toISOString() : undefined };
  if (!Number.isFinite(epoch.getTime()) || Math.abs(date.getTime() - epoch.getTime()) > 7 * DAY) {
    return { ...base, available: false, observable: false, warning: 'Orbital elements are more than 7 days from the selected time. Position and pass prediction unavailable.' };
  }
  const state = S.propagate(satrec, date);
  if (!state || !state.position || ![state.position.x, state.position.y, state.position.z].every(Number.isFinite)) {
    return { ...base, available: false, observable: false, warning: 'These orbital elements cannot be propagated to the selected time.' };
  }
  const ground = { longitude: observer.longitude * RAD, latitude: observer.latitude * RAD, height: observer.elevation / 1000 };
  const look = S.ecfToLookAngles(ground, S.eciToEcf(state.position, S.gstime(date)));
  const geometricAltitude = look.elevation * DEG;
  const hor = new A.Vector(Math.cos(look.elevation) * Math.cos(look.azimuth), -Math.cos(look.elevation) * Math.sin(look.azimuth), Math.sin(look.elevation), new A.AstroTime(date));
  const eq = A.EquatorFromVector(A.RotateVector(A.Rotation_HOR_EQJ(date, observerFor(observer)), hor));
  const sunlit = isSatelliteSunlit(state.position, sunVector ?? S.sunPos(S.jday(date)).rsun);
  return { ...base, altitude: geometricAltitude + A.Refraction('normal', geometricAltitude), azimuth: normalize(look.azimuth * DEG), ra: eq.ra, dec: eq.dec, available: true, observable: sunlit && sunAltitude < -6, distance: `${Math.round(look.rangeSat)} km`, warning: !sunlit ? 'In Earth’s shadow or penumbra.' : sunAltitude >= -6 ? 'The observer’s sky is too bright for this pass.' : 'Sunlit in a dark sky; brightness is unknown, so visibility is not guaranteed.' };
}

/** Propagate fast-moving satellites separately from the large star catalog. */
export function computeSatellites(date: Date, observer: ObserverLocation, satellites: SatelliteRecord[]): SkyObject[] {
  if (!Number.isFinite(date.getTime())) throw new RangeError('A valid observing date is required.');
  if (!satellites.length) return [];
  const sunAltitude = getSunAltitude(date, observer);
  const sunVector = S.sunPos(S.jday(date)).rsun;
  return satellites.map(record => satelliteObject(record, date, observer, sunAltitude, sunVector));
}

export function computeSky(date: Date, observer: ObserverLocation, stars: StarRecord[], satellites: SatelliteRecord[] = []): SkyObject[] {
  if (!Number.isFinite(date.getTime())) throw new RangeError('A valid observing date is required.');
  const rotation = A.Rotation_EQJ_HOR(date, observerFor(observer));
  const bodies = planets(date, observer, rotation);
  const years = (date.getTime() - J2000) / (365.25 * DAY);
  const stellar: SkyObject[] = prepareStars(stars.length ? stars : BRIGHT_STARS).map(({ record, base, velocity, color, description }) => {
    const vector = { x: base.x + years * velocity.x, y: base.y + years * velocity.y, z: base.z + years * velocity.z };
    return { id: record.id, name: record.name, category: 'star', ...horizontal(vector, rotation), ra: normalize(Math.atan2(vector.y, vector.x) * DEG) / 15, dec: Math.atan2(vector.z, Math.hypot(vector.x, vector.y)) * DEG, magnitude: record.magnitude, color, description, constellation: record.constellation, source: STAR_SOURCE, sourceUrl: STAR_URL, available: true };
  });
  return [...bodies, ...jupiterMoons(date, observer, rotation), ...stellar, ...computeSatellites(date, observer, satellites)];
}

export function getSunAltitude(date: Date, observer: ObserverLocation): number {
  const at = observerFor(observer), eq = A.Equator(A.Body.Sun, date, at, true, true);
  return A.Horizon(date, at, eq.ra, eq.dec, 'normal').altitude;
}

/** Illuminated fraction, from 0 (new) through 1 (full). */
export function getMoonPhase(date: Date): number { return A.Illumination(A.Body.Moon, date).phase_fraction; }
export function modeMagnitudeLimit(mode: ObservingMode): number { return { eye: 6, binocular: 9, telescope: 12 }[mode]; }
export function cardinalDirection(azimuth: number): string { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(normalize(azimuth) / 22.5) % 16]; }

/** A planning estimate for clear, dark skies, not a promise of real-world detectability. */
export function getVisibility(object: SkyObject, mode: ObservingMode, sunAltitude: number): { visible: boolean; reason: string } {
  if (object.available === false || !Number.isFinite(object.altitude)) return { visible: false, reason: object.warning ?? 'Position unavailable' };
  if (object.altitude <= 0) return { visible: false, reason: 'Below the horizon' };
  if (object.id === 'sun') return { visible: true, reason: 'Above the horizon · solar reference' };
  if (object.category === 'satellite') return object.observable === true ? { visible: true, reason: 'Potentially visible · brightness unknown' } : { visible: false, reason: object.warning ?? 'No sunlit pass in darkness' };
  if (object.observable === false) return { visible: false, reason: object.warning ?? 'Not observable now' };
  if (GALILEANS.some(([id]) => id === object.id) && mode !== 'telescope') return { visible: false, reason: 'Use a small telescope to resolve Jupiter’s moons' };
  if (object.id === 'moon') return (object.phase ?? 0.5) < 0.01 ? { visible: false, reason: 'Near new Moon · normally lost in the Sun’s glare' } : { visible: true, reason: 'Above the horizon' };
  if (object.magnitude === null) return { visible: false, reason: 'Brightness unavailable · position can still be explored' };
  const baseLimit = modeMagnitudeLimit(mode);
  if (object.magnitude > baseLimit) return { visible: false, reason: `Fainter than the approximate ${mode} limit (magnitude ${baseLimit})` };
  // Smoothly suppress faint targets through twilight. Full catalog depth requires astronomical darkness.
  const daylightLimit = sunAltitude >= 0 ? -4.5 : sunAltitude >= -6 ? -4.5 + (-sunAltitude / 6) * 5.5 : sunAltitude >= -18 ? 1 + ((-sunAltitude - 6) / 12) * (baseLimit - 1) : baseLimit;
  if (object.magnitude > daylightLimit) return { visible: false, reason: sunAltitude > -6 ? 'Lost in daylight / bright twilight' : 'Twilight limits faint objects' };
  return { visible: true, reason: object.altitude < 10 ? 'Low on the horizon · haze and terrain may obscure it' : 'Within this mode’s approximate brightness limit' };
}

function crossing(start: number, end: number, altitude: (time: number) => { altitude: number; azimuth: number }): RiseEvent {
  for (let iteration = 0; iteration < 20 && end - start > 500; iteration++) {
    const middle = (start + end) / 2;
    if (altitude(middle).altitude > 0) end = middle; else start = middle;
  }
  return { time: new Date(end).toISOString(), azimuth: altitude(end).azimuth, kind: 'rise' };
}

/** Next geometric/refracted rise; null for an always-up/never-up star, or no event within the search window. */
export function getRiseEvent(object: SkyObject, date: Date, observer: ObserverLocation, satellites: SatelliteRecord[] = []): RiseEvent | null {
  if (object.available === false) return null;
  const body = BODY_BY_ID.get(object.id);
  if (body) {
    const rise = A.SearchRiseSet(body, observerFor(observer), 1, date, 370);
    if (!rise) return null;
    const eq = A.Equator(body, rise, observerFor(observer), true, true);
    const at = A.Horizon(rise, observerFor(observer), eq.ra, eq.dec, 'normal');
    return { time: rise.date.toISOString(), azimuth: at.azimuth, kind: 'rise' };
  }
  if (object.category === 'satellite') {
    const record = satellites.find(s => `sat-${satrecFor(s).satnum}` === object.id);
    if (!record) return null;
    // 20-second sampling through 48 hours finds observable portions of short LEO passes.
    let previous = object.altitude > 0 && object.observable === true;
    for (let delta = 20_000; delta <= 2 * DAY; delta += 20_000) {
      const when = new Date(date.getTime() + delta);
      const point = satelliteObject(record, when, observer, getSunAltitude(when, observer));
      if (!point.available) return null;
      const visible = point.altitude > 0 && point.observable === true;
      if (visible && !previous) return { time: when.toISOString(), azimuth: point.azimuth, kind: 'pass' };
      previous = visible;
    }
    return null;
  }
  const galilean = GALILEANS.some(([id]) => id === object.id);
  if (object.category !== 'star' && !galilean) return null; // Small-body rises come from Horizons, never frozen RA/Dec.
  const positionAt = (time: number) => {
    const when = new Date(time);
    if (galilean) return jupiterMoons(when, observer, A.Rotation_EQJ_HOR(when, observerFor(observer))).find(m => m.id === object.id)!;
    return equatorialToHorizontal(object.ra, object.dec, when, observer);
  };
  let before = date.getTime(), previous = positionAt(before).altitude;
  for (let delta = 5 * 60_000; delta <= 2 * DAY; delta += 5 * 60_000) {
    const after = date.getTime() + delta, next = positionAt(after).altitude;
    if (previous <= 0 && next > 0) return crossing(before, after, positionAt);
    previous = next;
    before = after;
  }
  return null;
}
