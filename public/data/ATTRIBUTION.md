# Nocturne sky data

## Stars

`stars.json` contains **83,479 stars through visual magnitude 9.0** from the
[HYG Stellar Database v4.1](https://github.com/astronexus/HYG-Database), compiled by
**David Nash / Astronomy Nexus** from Hipparcos, the Yale Bright Star Catalog and
the Gliese Catalog. The data and this adapted catalog are licensed under
[Creative Commons Attribution–ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The license notice and full terms are included in `HYG-LICENSE.txt` and
`CC-BY-SA-4.0.txt`. The 103-record fallback in `src/lib/brightStars.ts` is covered
by the same license.

Source: `hyg/CURRENT/hygdata_v41.csv` from the archived HYG GitHub repository.
Downloaded 2026-09-30. Source SHA-256:
`d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd`.

Changes: omitted the Sun and records fainter than magnitude 9; retained ID,
display name, J2000 right ascension (hours), declination (degrees), visual
magnitude, B−V color index, constellation abbreviation and proper motion
(milliarcseconds/year); renamed fields; sorted by magnitude; converted CSV to
JSON. Display names use a proper name, Bayer/Flamsteed designation or catalog ID
in that order. `pmra` includes cos(declination), as in Hipparcos. Proper motion,
precession, nutation and a standard refraction model are applied at runtime.
Stellar annual parallax, radial motion and variability are not modeled.

This is a broad bright-star catalog, not every star detectable with a telescope.
The telescope setting reaches magnitude 12 for available objects, but this
bundled stellar catalog stops at magnitude 9. Catalog completeness varies by
sky region and source survey. Close components can appear separately.

## Constellation lines

`constellations.json` is the unmodified `data/constellations.lines.json` from
[d3-celestial by Olaf Frohn](https://github.com/ofrohn/d3-celestial).
Copyright © 2015 Olaf Frohn; BSD 3-Clause terms in `d3-celestial-LICENSE.txt`.
Coordinates are J2000 longitude (right ascension in **degrees**) and declination
in degrees, grouped as GeoJSON MultiLineString features.

## Solar system and satellites

Planet, Sun and Moon positions and the four Galilean moon orbits are calculated
locally with [Astronomy Engine by Don Cross](https://github.com/cosinekitty/astronomy)
(MIT). Positions account for the observer, precession/nutation and light travel
time. Galilean moon brightness is an approximate distance-scaled estimate;
simple Jupiter disk/shadow geometry hides eclipsed or unresolved moons. It is
not an occultation timing tool.

Satellite positions use public [CelesTrak orbital elements](https://celestrak.org/NORAD/elements/)
and [satellite.js](https://github.com/shashwatak/satellite-js) (MIT) SGP4.
Elements are rejected beyond seven days from their epoch, in either direction.
Potential optical visibility requires sunlight and solar altitude below −6°.
A spherical Earth/Sun shadow test conservatively excludes penumbra. Satellite
brightness, attitude, flares and atmospheric extinction are not predicted.
Pass searches cover the next 48 hours in 20-second steps. A “pass” time can be
the start of illumination above the horizon, rather than geometric rise.

Approximate limiting magnitudes are 6 (eye), 9 (binoculars) and 12 (small
telescope), with reduced depth in twilight. Actual conditions, light pollution,
Moon glare, aperture, obstruction and observer experience change what is seen.
Rise events assume a mathematical horizon with standard atmospheric refraction;
decorative landscape is not terrain elevation data. Solar/lunar rises use the
upper limb; star rises use the point source. Stars search two days, major bodies
370 days, and satellites two days. No result means no event within that window.

Minor-body positions are supplied separately by the application’s NASA/JPL
Horizons service; they are never inferred from star-like fixed coordinates.
