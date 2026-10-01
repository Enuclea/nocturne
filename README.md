# Nocturne

A dark, interactive observatory for the sky above any city or coordinates. Built with React, TypeScript, Three.js, Astronomy Engine, and an Express data service.

## Run with Docker

```sh
docker compose up --build -d
```

Open **http://localhost:8088**. The container has a health check, runs as an unprivileged user, and stores public-data cache entries in the `sky-cache` volume. Stop it with `docker compose down`. The same image works on ARM64 and AMD64 when built for the target platform.

To use a different port, run `SKY_PORT=8090 docker compose up -d` or set `SKY_PORT` in `.env`.

## Run locally

Requires Node.js 22.22.2+, 24.15+, or 26+ (including development and tests).

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api` to the server on port 3001.

```sh
npm test       # Numerical astronomy, parsing, and validation checks
npm run build # Type checking and production bundle
npm start     # Serve the production build on port 3001
```

## Explore

- Choose a city, enter decimal latitude and longitude, or request your device location.
- Set a date and time in the selected location's time zone, return to the live sky, or jump to tonight. Choose a **Step / speed** of 1 hour (default), 30/5/1 minutes, or 30/10/5/1 seconds. The arrows move by that interval; Play advances by that much simulated time per real second (1s = real time, 5s = 5×, 1h = 3600×). Speed changes apply immediately while time is running, including from the live sky; paused time stays paused until Play. The clock shows seconds when a seconds-based step is selected. During playback, its readout ticks once per real second by the selected interval, while the sky moves continuously between ticks.
- Drag to look around; scroll or pinch to zoom. The focused sky supports arrow keys and +/−.
- Switch between **eye**, **binoculars**, and **small telescope**. Their approximate dark-sky limiting magnitudes are 6, 9, and 12.
- Expand the object classes on the left. Select an object to center the sky, inspect altitude/azimuth/brightness, or see its next rise and direction.
- Toggle constellation lines, the coordinate grid, and the illustrative landscape.
- Search NASA/JPL for additional comets and asteroids beyond the starter catalog.

## Data and coverage

| Objects | Source and calculation |
| --- | --- |
| Mercury through Neptune, Pluto, Sun, Moon | [Astronomy Engine](https://github.com/cosinekitty/astronomy), calculated locally for the observer and date. Topocentric positions include light time, precession, and atmospheric refraction. |
| Io, Europa, Ganymede, Callisto | Astronomy Engine's Galilean moon model, with approximate brightness and checks for Jupiter's disk and shadow. |
| 83,479 stars to catalog magnitude 9 | [HYG v4.1](https://github.com/astronexus/HYG-Database), bundled for offline use. Proper motion and date-dependent coordinate rotation are applied. |
| Constellation lines | [D3 Celestial](https://github.com/ofrohn/d3-celestial), based on real celestial coordinates. |
| Comets and asteroids | [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) and its small-body lookup. Sixteen starter entries plus search of the wider JPL catalog. Positions are fetched when an object is selected. |
| Artificial satellites | [CelesTrak visual group](https://celestrak.org/NORAD/elements/), propagated with [satellite.js / SGP4](https://github.com/shashwatak/satellite-js). Brightness is unknown; sunlit geometry and observer darkness indicate potentially visible passes. |
| City search and time zones | [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) / [GeoNames](https://www.geonames.org/). |

Data attribution and licenses are included under `public/data/`. Stars and major solar-system positions work without an external connection after the application is loaded. New city searches, small-body positions, and fresh satellite elements require internet access. Provider failures appear in the interface; the application does not substitute invented positions.

### Precision and observing limits

This is an observing planner and visual sky map. It does not model weather, light pollution, terrain at your actual location, atmospheric extinction, or the exact properties of your instrument. The drawn landscape is illustrative. Celestial point sizes and halos are exaggerated for legibility.

The star catalog stops at magnitude 9 in all three modes: the telescope mode does **not** claim a complete magnitude-12 star survey. The small-body starter catalog and CelesTrak visual group are also subsets. Search reaches additional JPL comets and asteroids, but this is not an exhaustive automatic survey of every observable solar-system body. Natural satellites beyond the Moon and four Galilean moons are not included.

Horizons positions are interpolated between five-minute topocentric samples. Rise predictions use an unobstructed horizon and are approximate. A selected date must fall within 1900–2100; individual small-body trajectories can have narrower valid periods. Rise searches have finite windows, so “no rise found” does not always mean an object never rises. Satellite passes search 48 hours in 20-second steps, and predictions are disabled if the element epoch is more than seven days from the selected time. A sunlit satellite may still be too faint to see. Comet brightness can differ substantially from its predicted magnitude.

The Sun is a daytime reference. Never point binoculars or a telescope at it without an appropriate, securely fitted solar filter.

## Public-service caching and deployment

The server keeps NASA requests sequential and caches 48-hour ephemerides for seven days, lookup results for one day, city results for seven days, and satellite elements for two hours. Identical concurrent requests share one fetch. NASA failures trigger a one-minute backoff. No API keys are needed for the default personal-use sources.

Before running a shared installation, set `JPL_USER_AGENT` to identify your installation with a real operator contact, as requested by [JPL's fair-use policy](https://ssd-api.jpl.nasa.gov/doc/index.php). Copy `.env.example` to `.env` and customize it; Docker Compose loads it automatically. Commercial geocoding use may require an appropriate Open-Meteo plan. Use HTTPS through your preferred reverse proxy for device geolocation outside localhost.

Optional environment variables:

- `PORT`: server port (default `3001`).
- `CACHE_DIR`: disk cache directory (default `.cache`, `/data/cache` in Docker).
- `JPL_USER_AGENT`: application-specific upstream User-Agent with operator contact.

## Layout

```text
src/App.tsx                  Interface and observing state
src/components/SkyScene.tsx  Three.js sky and procedural landscape
src/lib/astronomy.ts         Celestial coordinates and visibility estimates
public/data/                Bundled real star/constellation catalogs and licenses
server/                     Cached public-data proxy and Horizons parser
tests/                      Numerical and data-contract tests
Dockerfile, compose.yaml    Portable production deployment
```
