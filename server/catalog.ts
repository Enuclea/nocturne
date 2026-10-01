import type { SmallBodyRecord } from '../src/types.js';

// Horizons small-body designations. These are entry points, not a claim of
// current visibility: each position and magnitude comes from a fresh ephemeris.
export const catalog: SmallBodyRecord[] = [
  ['1;', 'Ceres', 'asteroid', 'The largest object in the asteroid belt, and a dwarf planet.'],
  ['4;', 'Vesta', 'asteroid', 'A bright, rocky world in the main asteroid belt.'],
  ['2;', 'Pallas', 'asteroid', 'A large asteroid on a highly inclined orbit.'],
  ['3;', 'Juno', 'asteroid', 'One of the first asteroids discovered.'],
  ['7;', 'Iris', 'asteroid', 'A relatively bright main-belt asteroid.'],
  ['6;', 'Hebe', 'asteroid', 'A rocky main-belt asteroid.'],
  ['15;', 'Eunomia', 'asteroid', 'A large member of the main asteroid belt.'],
  ['433;', 'Eros', 'asteroid', 'A near-Earth asteroid visited by the NEAR Shoemaker spacecraft.'],
  ['99942;', 'Apophis', 'asteroid', 'A near-Earth asteroid. Brightness changes strongly with its distance.'],
  ['DES=1P;CAP;', '1P / Halley', 'comet', 'The famous periodic comet. Usually far too faint for small instruments.'],
  ['DES=2P;CAP;', '2P / Encke', 'comet', 'A short-period comet with a roughly 3.3-year orbit.'],
  ['DES=12P;CAP;', '12P / Pons–Brooks', 'comet', 'A periodic comet known for occasional outbursts.'],
  ['DES=46P;CAP;', '46P / Wirtanen', 'comet', 'A short-period comet; visibility changes greatly between apparitions.'],
  ['DES=67P;CAP;', '67P / Churyumov–Gerasimenko', 'comet', 'The comet explored by the Rosetta mission.'],
  ['DES=C/2023 A3;CAP;', 'C/2023 A3 / Tsuchinshan–ATLAS', 'comet', 'A long-period comet discovered in 2023.'],
  ['DES=C/2025 A6;CAP;', 'C/2025 A6 / Lemmon', 'comet', 'A long-period comet. Check the calculated magnitude for your date.'],
].map(([id, name, category, description]) => ({ id, name, category, description } as SmallBodyRecord));
