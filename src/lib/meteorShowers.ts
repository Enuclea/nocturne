import * as A from 'astronomy-engine';
import { equatorialToHorizontal } from './astronomy';
import type { ObserverLocation } from '../types';

const DAY = 86_400_000;
const DEGREES_PER_DAY = 360 / 365.2422;

export interface MeteorShower {
  id: string; name: string; parent: string;
  /** J2000 solar longitude of maximum, so peaks follow the calendar year to year. */
  peakLongitude: number;
  /** Activity window, in days relative to the peak. */
  start: number; end: number;
  /** J2000 radiant at the peak, in degrees, and its daily drift. */
  ra: number; dec: number; raDrift: number; decDrift: number;
  zhr: number; velocity: number; note?: string;
  /** Bright, named stars that lead the eye to the radiant, and how to use them. */
  guides: string[]; finder: string;
}

// Major and long-established showers from the IMO Meteor Shower Calendar working list.
// Dates and radiants are typical values; ZHR is the ideal peak rate under a dark sky
// with the radiant overhead, so observed rates are usually lower.
export const METEOR_SHOWERS: MeteorShower[] = [
  { id: 'quadrantids', name: 'Quadrantids', parent: 'asteroid 2003 EH1', peakLongitude: 283.15, start: -6, end: 9, ra: 230, dec: 49, raDrift: 0.8, decDrift: -0.2, zhr: 80, velocity: 41, note: 'A sharp peak lasting only a few hours.', guides: ['Alkaid', 'Nekkar'], finder: 'Between the end of the Big Dipper’s handle (Alkaid) and the top of Boötes (Nekkar).' },
  { id: 'lyrids', name: 'Lyrids', parent: 'comet C/1861 G1 (Thatcher)', peakLongitude: 32.32, start: -8, end: 8, ra: 271, dec: 34, raDrift: 1.1, decDrift: 0, zhr: 18, velocity: 49, guides: ['Vega'], finder: 'Just west of Vega, the brilliant blue-white star of Lyra.' },
  { id: 'eta-aquariids', name: 'Eta Aquariids', parent: 'comet 1P/Halley', peakLongitude: 45.5, start: -17, end: 22, ra: 338, dec: -1, raDrift: 0.9, decDrift: 0.4, zhr: 50, velocity: 66, note: 'Best from the Southern Hemisphere, in the hours before dawn.', guides: ['Sadalmelik'], finder: 'Rises before dawn by the Water Jar of Aquarius, close to Sadalmelik.' },
  { id: 'southern-delta-aquariids', name: 'Southern Delta Aquariids', parent: 'comet 96P/Machholz (probable)', peakLongitude: 127, start: -18, end: 24, ra: 340, dec: -16, raDrift: 0.8, decDrift: 0.2, zhr: 25, velocity: 41, guides: ['Skat', 'Fomalhaut'], finder: 'Beside Skat in Aquarius, low in the south and well above bright Fomalhaut.' },
  { id: 'alpha-capricornids', name: 'Alpha Capricornids', parent: 'comet 169P/NEAT', peakLongitude: 127, start: -27, end: 16, ra: 307, dec: -10, raDrift: 0.9, decDrift: 0.3, zhr: 5, velocity: 23, note: 'Few meteors, but slow and known for bright fireballs.', guides: ['Algedi', 'Altair'], finder: 'Just north of Algedi in Capricornus, south of bright Altair.' },
  { id: 'perseids', name: 'Perseids', parent: 'comet 109P/Swift–Tuttle', peakLongitude: 140, start: -26, end: 12, ra: 48, dec: 58, raDrift: 1.35, decDrift: 0.2, zhr: 100, velocity: 59, guides: ['Mirfak', 'Segin'], finder: 'Between Mirfak in Perseus and the W of Cassiopeia, whose nearest star is Segin.' },
  { id: 'southern-taurids', name: 'Southern Taurids', parent: 'comet 2P/Encke', peakLongitude: 197, start: -30, end: 41, ra: 32, dec: 9, raDrift: 0.8, decDrift: 0.23, zhr: 5, velocity: 27, note: 'A long, gentle shower with occasional slow fireballs.', guides: ['Hamal', 'Menkar'], finder: 'A broad radiant between Hamal in Aries and Menkar in Cetus.' },
  { id: 'draconids', name: 'Draconids', parent: 'comet 21P/Giacobini–Zinner', peakLongitude: 195.4, start: -2, end: 2, ra: 262, dec: 54, raDrift: 0, decDrift: 0, zhr: 10, velocity: 20, note: 'Usually quiet, with rare outbursts. Best in the early evening.', guides: ['Eltanin', 'Rastaban'], finder: 'By the head of Draco, the small quadrilateral marked by Eltanin and Rastaban.' },
  { id: 'orionids', name: 'Orionids', parent: 'comet 1P/Halley', peakLongitude: 208, start: -19, end: 17, ra: 95, dec: 16, raDrift: 0.7, decDrift: 0.1, zhr: 20, velocity: 66, guides: ['Betelgeuse', 'Alhena'], finder: 'Northeast of Betelgeuse, close to Alhena at the feet of Gemini.' },
  { id: 'northern-taurids', name: 'Northern Taurids', parent: 'comet 2P/Encke', peakLongitude: 230, start: -23, end: 28, ra: 58, dec: 22, raDrift: 0.85, decDrift: 0.15, zhr: 5, velocity: 29, note: 'A long, gentle shower with occasional slow fireballs.', guides: ['Alcyone', 'Aldebaran'], finder: 'Just south of the Pleiades (Alcyone), toward Aldebaran in Taurus.' },
  { id: 'leonids', name: 'Leonids', parent: 'comet 55P/Tempel–Tuttle', peakLongitude: 235.27, start: -11, end: 13, ra: 152, dec: 22, raDrift: 0.7, decDrift: -0.4, zhr: 15, velocity: 70, guides: ['Algieba', 'Regulus'], finder: 'In the Sickle of Leo, the backward question mark above Regulus, near Algieba.' },
  { id: 'geminids', name: 'Geminids', parent: 'asteroid 3200 Phaethon', peakLongitude: 262.2, start: -10, end: 6, ra: 112, dec: 33, raDrift: 1, decDrift: -0.1, zhr: 150, velocity: 35, note: 'The richest shower of the year, active from mid-evening.', guides: ['Castor', 'Pollux'], finder: 'Right beside Castor, the upper of the two Gemini twins.' },
  { id: 'ursids', name: 'Ursids', parent: 'comet 8P/Tuttle', peakLongitude: 270.7, start: -5, end: 4, ra: 217, dec: 76, raDrift: 0, decDrift: 0, zhr: 10, velocity: 33, guides: ['Kochab', 'Polaris'], finder: 'Beside Kochab, the bright end of the Little Dipper’s bowl, not far from Polaris.' },
];

export interface ActiveShower {
  shower: MeteorShower;
  daysFromPeak: number; peak: Date;
  ra: number; dec: number;
  altitude: number; azimuth: number;
  /** 0–1 visual weight combining peak rate and closeness to the peak. */
  strength: number;
}

/** Apparent solar longitude in the J2000 ecliptic frame, in degrees. */
export function solarLongitude(date: Date) {
  return A.Ecliptic(A.GeoVector(A.Body.Sun, date, true)).elon;
}

const wrap = (degrees: number) => ((degrees + 540) % 360) - 180;

/** Days from the shower's nearest peak (negative before the peak). */
export function daysFromPeak(shower: MeteorShower, date: Date) {
  return wrap(solarLongitude(date) - shower.peakLongitude) / DEGREES_PER_DAY;
}

export function peakDate(shower: MeteorShower, date: Date) {
  let time = date.getTime() - daysFromPeak(shower, date) * DAY;
  for (let i = 0; i < 2; i++) time -= daysFromPeak(shower, new Date(time)) * DAY;
  return new Date(time);
}

export function activeShowers(date: Date, observer: ObserverLocation): ActiveShower[] {
  return METEOR_SHOWERS.flatMap(shower => {
    const days = daysFromPeak(shower, date);
    if (days < shower.start || days > shower.end) return [];
    const ra = (shower.ra + shower.raDrift * days + 360) % 360;
    const dec = shower.dec + shower.decDrift * days;
    const { altitude, azimuth } = equatorialToHorizontal(ra / 15, dec, date, observer);
    const closeness = 1 - Math.min(1, Math.abs(days) / Math.max(-shower.start, shower.end));
    const strength = Math.min(1, 0.25 + 0.75 * Math.sqrt(shower.zhr / 150) * (0.35 + 0.65 * closeness));
    return [{ shower, daysFromPeak: days, peak: peakDate(shower, date), ra, dec, altitude, azimuth, strength }];
  }).sort((a, b) => b.strength - a.strength);
}

export function nextShower(date: Date) {
  return METEOR_SHOWERS.map(shower => {
    let days = -daysFromPeak(shower, date);
    if (days < 0) days += 365.2422;
    return { shower, peak: new Date(date.getTime() + days * DAY), days };
  }).sort((a, b) => a.days - b.days)[0];
}

export function peakLabel(days: number) {
  const rounded = Math.round(days);
  if (rounded === 0) return 'Peak tonight';
  if (rounded < 0) return `Peak in ${-rounded} ${rounded === -1 ? 'day' : 'days'}`;
  return `Peaked ${rounded} ${rounded === 1 ? 'day' : 'days'} ago`;
}
