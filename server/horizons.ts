import type { EphemerisResult, RiseEvent, SmallBodyRecord } from '../src/types.js';
import { cached, nasaRequest, remoteJson } from './cache.js';
import { catalog } from './catalog.js';

export interface Sample { time: number; ra: number; dec: number; azimuth: number; altitude: number; magnitude: number | null; distance: number | null; }
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const numberOrNull = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
export function parseHorizons(text: string): Sample[] {
  const block = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!block) throw new Error('NASA/JPL could not compute an ephemeris for this object and date.');
  const samples: Sample[] = [];
  for (const line of block.trim().split('\n')) {
    const columns = line.split(',').map(s => s.trim());
    const date = columns[0]?.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::([\d.]+))?$/);
    if (!date || columns.length < 10) continue;
    const month = months.indexOf(date[2]);
    const values = columns.slice(3, 7).map(numberOrNull);
    if (month < 0 || values.some(v => v === null)) continue;
    samples.push({ time: Date.UTC(+date[1], month, +date[3], +date[4], +date[5], +(date[6] || 0)), ra: values[0]! / 15, dec: values[1]!, azimuth: values[2]!, altitude: values[3]!, magnitude: numberOrNull(columns[7]), distance: numberOrNull(columns[9]) });
  }
  if (samples.length < 2) throw new Error('NASA/JPL returned no usable sky positions.');
  return samples;
}
const radians = Math.PI / 180;
export function interpolateSample(a: Sample, b: Sample, time: number): Sample {
  const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
  const blend = (x: number, y: number) => x + (y - x) * t;
  // Interpolate unit direction vectors to remain continuous at north and the zenith.
  const vector = (s: Sample) => [Math.cos(s.altitude * radians) * Math.sin(s.azimuth * radians), Math.sin(s.altitude * radians), Math.cos(s.altitude * radians) * Math.cos(s.azimuth * radians)];
  const va = vector(a), vb = vector(b), v = va.map((x, i) => blend(x, vb[i]));
  const norm = Math.hypot(...v);
  const raDelta = ((b.ra - a.ra + 36) % 24) - 12;
  return { time, ra: (a.ra + raDelta * t + 24) % 24, dec: blend(a.dec, b.dec), azimuth: (Math.atan2(v[0], v[2]) / radians + 360) % 360, altitude: Math.asin(v[1] / norm) / radians, magnitude: a.magnitude === null || b.magnitude === null ? null : blend(a.magnitude, b.magnitude), distance: a.distance === null || b.distance === null ? null : blend(a.distance, b.distance) };
}
export function nextRise(samples: Sample[], after: number): RiseEvent | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (b.time <= after || a.altitude >= 0 || b.altitude < 0) continue;
    const time = a.time + (b.time - a.time) * (-a.altitude / (b.altitude - a.altitude));
    if (time <= after) continue;
    return { time: new Date(time).toISOString(), azimuth: interpolateSample(a, b, time).azimuth, kind: 'rise' };
  }
  return null;
}

interface LookupResult { signature?: { version: string }; result?: { name: string; spkid: string; type?: string; pdes?: string }[]; count?: string; error?: string; }
export async function searchSmallBodies(query: string): Promise<SmallBodyRecord[]> {
  return cached(`lookup-v1:${query.toLowerCase()}`, 24 * 3600_000, async () => {
    const url = new URL('https://ssd.jpl.nasa.gov/api/horizons_lookup.api');
    url.search = new URLSearchParams({ sstr: query, group: 'sb', format: 'json' }).toString();
    const data = await nasaRequest(() => remoteJson<LookupResult>(url));
    if (data.error) throw new Error('NASA/JPL could not look up that name. Try a designation such as 4 or C/2023 A3.');
    if (data.signature && !['1.0', '1.1'].includes(data.signature.version)) throw new Error('The NASA/JPL lookup format changed. Please update Nocturne.');
    return (data.result || []).slice(0, 40).filter(item => /^\d+$/.test(item.spkid)).map(item => ({
      id: `DES=${item.spkid};`, name: item.name,
      category: /comet/i.test(item.type || '') || /\d+P\/|C\/\d{4}/.test(item.name) ? 'comet' : 'asteroid',
      description: `NASA/JPL small-body catalog · ${item.pdes || item.name}`,
    }));
  });
}

export async function getEphemeris(id: string, latitude: number, longitude: number, elevation: number, date: Date): Promise<EphemerisResult> {
  const known = catalog.find(item => item.id === id);
  if (!known && !/^DES=\d{1,12};$/.test(id)) throw new Error('Unknown small-body identifier. Search the catalog first.');
  const start = new Date(date); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 48 * 3600_000);
  const key = `horizons-v2:${id}:${latitude.toFixed(5)}:${longitude.toFixed(5)}:${elevation.toFixed(0)}:${start.toISOString().slice(0,10)}`;
  const data = await cached(key, 7 * 24 * 3600_000, async () => {
    const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
    const q = (v: string) => `'${v}'`;
    const parameters = { format: 'json', COMMAND: q(id), OBJ_DATA: q('YES'), MAKE_EPHEM: q('YES'), EPHEM_TYPE: q('OBSERVER'), CENTER: q('coord@399'), COORD_TYPE: q('GEODETIC'), SITE_COORD: q(`${longitude},${latitude},${elevation / 1000}`), START_TIME: q(start.toISOString().slice(0,16).replace('T',' ')), STOP_TIME: q(end.toISOString().slice(0,16).replace('T',' ')), STEP_SIZE: q('5 m'), QUANTITIES: q('1,4,9,20'), CSV_FORMAT: q('YES'), ANG_FORMAT: q('DEG'), APPARENT: q('REFRACTED'), EXTRA_PREC: q('YES') };
    url.search = new URLSearchParams(parameters).toString();
    const response = await nasaRequest(() => remoteJson<{ result?: string; error?: string; signature?: { version: string } }>(url));
    if (response.signature && response.signature.version !== '1.2' && response.signature.version !== '1.3') throw new Error('The NASA/JPL ephemeris format changed. Please update Nocturne.');
    if (!response.result || response.error) throw new Error('NASA/JPL has no ephemeris for this object and date. Try another date or object.');
    const name = response.result.match(/Target body name:\s*(.*?)\s*\{/)?.[1]?.trim() || known?.name || id;
    return { samples: parseHorizons(response.result), name, category: known?.category || (/Comet|comet|\d+P\/|C\/\d{4}/.test(response.result.slice(0, 2500)) ? 'comet' : 'asteroid') as 'comet' | 'asteroid' };
  });
  const index = data.samples.findIndex(s => s.time > date.getTime());
  if (index <= 0) throw new Error('The requested time is outside the ephemeris window.');
  const sample = interpolateSample(data.samples[index - 1], data.samples[index], date.getTime());
  return {
    object: { id, name: known?.name || data.name, category: data.category, altitude: sample.altitude, azimuth: sample.azimuth, ra: sample.ra, dec: sample.dec, magnitude: sample.magnitude, color: data.category === 'comet' ? '#90cfbe' : '#c4b6a3', description: known?.description || 'A small world in our solar system, located using NASA/JPL Horizons.', distance: sample.distance === null ? undefined : `${sample.distance.toFixed(3)} AU`, source: 'NASA/JPL Horizons', sourceUrl: 'https://ssd.jpl.nasa.gov/horizons/', available: true, warning: `${data.category === 'comet' ? 'Comet brightness is uncertain. ' : ''}Position interpolated from 5-minute ephemerides; rise times are approximate and assume a clear horizon.` },
    rise: nextRise(data.samples, date.getTime()), sampledAt: date.toISOString(), source: 'NASA/JPL Horizons',
  };
}
