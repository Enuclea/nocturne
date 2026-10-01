import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Binoculars, ChevronDown, ChevronLeft, ChevronRight, Compass, Crosshair, Eye, EyeOff, Globe2, Info, Layers3, LoaderCircle, LocateFixed, MapPin, Menu, Minus, Moon, Mountain, Orbit, Pause, Play, Plus, Search, Settings2, Sparkles, Star, Telescope, X } from 'lucide-react';
import Logo from './components/Logo';
import MeteorIcon from './components/MeteorIcon';
import SkyScene from './components/SkyScene';
import { cardinalDirection, computeSatellites, computeSky, getMoonPhase, getRiseEvent, getSunAltitude, getVisibility, modeMagnitudeLimit } from './lib/astronomy';
import { METEOR_SHOWERS, followTime, nextShower, peakLabel, showerInfo } from './lib/meteorShowers';
import { SimulationClock } from './lib/simulation-clock';
import type { Category, EphemerisResult, MeteorRadiant, ObserverLocation, ObservingMode, SatelliteRecord, SkyObject, SmallBodyRecord, StarRecord } from './types';

const DEFAULT_LOCATION: ObserverLocation = { name: 'New York, United States', latitude: 40.7128, longitude: -74.006, elevation: 10, timezone: 'America/New_York' };
const TIME_STEP_SECONDS = new Set([3600, 1800, 300, 60, 30, 10, 5, 1]);
const GROUPS: { id: Category; name: string; icon: typeof Star; subtitle: string }[] = [
  { id: 'planet', name: 'Planets', icon: Orbit, subtitle: 'Our wandering neighbors' },
  { id: 'moon', name: 'Moons', icon: Moon, subtitle: 'Our closest companion' },
  { id: 'star', name: 'Stars', icon: Sparkles, subtitle: 'Points of distant light' },
  { id: 'comet', name: 'Comets', icon: ArrowUpRight, subtitle: 'Travelers from the outer dark' },
  { id: 'asteroid', name: 'Asteroids', icon: Layers3, subtitle: 'Worlds in miniature' },
  { id: 'satellite', name: 'Satellites', icon: Globe2, subtitle: 'Human lights in orbit' },
];
type ExplorerGroup = Category | 'meteor';
const MODES: { id: ObservingMode; label: string; icon: typeof Eye }[] = [{ id: 'eye', label: 'Naked eye', icon: Eye }, { id: 'binocular', label: 'Binoculars', icon: Binoculars }, { id: 'telescope', label: 'Telescope', icon: Telescope }];
function formatDate(date: Date, timezone: string, options: Intl.DateTimeFormatOptions) { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(date); }
function zonedInput(date: Date, timezone: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string) => p.find(x => x.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
function fromZonedInput(value: string, timezone: string) {
  const nominal = Date.parse(value + ':00Z');
  if (!Number.isFinite(nominal)) return null;
  let time = nominal;
  for (let i = 0; i < 3; i++) { const represented = Date.parse(zonedInput(new Date(time), timezone) + ':00Z'); time += nominal - represented; }
  const date = new Date(time);
  return zonedInput(date, timezone) === value ? date : null;
}
function countdown(future: string, now: Date) {
  const minutes = Math.max(0, Math.ceil((new Date(future).getTime() - now.getTime()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes} min`;
}
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The data source is temporarily unavailable. Please try again.');
  return body;
}
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button, a'); first?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const all = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href], select, [tabindex="0"]');
        if (!all?.length) return;
        if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); all[all.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === all[all.length - 1]) { e.preventDefault(); all[0].focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'modal-wide' : ''}`}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>{children}</div></div>;
}

export default function App() {
  const [observer, setObserver] = useState<ObserverLocation>(() => { try { const saved = JSON.parse(localStorage.getItem('nocturne-location') || 'null'); if (saved && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude) && Math.abs(saved.latitude) <= 90 && Math.abs(saved.longitude) <= 180 && typeof saved.timezone === 'string') { new Intl.DateTimeFormat('en', { timeZone: saved.timezone }); return saved; } } catch {} return DEFAULT_LOCATION; });
  const [date, setDate] = useState(() => new Date());
  const clock = useRef<SimulationClock | null>(null);
  if (!clock.current) clock.current = new SimulationClock(date.getTime(), performance.now(), 1);
  const [live, setLive] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [timeStepSeconds, setTimeStepSeconds] = useState(3600);
  const timeStepSelect = useRef<HTMLSelectElement>(null);
  const latestTimeStep = useRef(3600);
  const timeStepValue = timeStepSeconds >= 3600 ? timeStepSeconds / 3600 : timeStepSeconds >= 60 ? timeStepSeconds / 60 : timeStepSeconds;
  const timeStepUnit = timeStepSeconds >= 3600 ? 'hour' : timeStepSeconds >= 60 ? 'minute' : 'second';
  const timeStepLabel = `${timeStepValue} ${timeStepUnit}${timeStepValue === 1 ? '' : 's'}`;
  const showSeconds = timeStepSeconds < 60;
  const readoutDate = playing ? new Date(clock.current.getDisplayTime(performance.now())) : date;
  const [mode, setMode] = useState<ObservingMode>('eye');
  const [stars, setStars] = useState<StarRecord[]>([]);
  const [starWarning, setStarWarning] = useState('');
  const [satellites, setSatellites] = useState<SatelliteRecord[]>([]);
  const [satelliteWarning, setSatelliteWarning] = useState('Loading orbital elements…');
  const [catalog, setCatalog] = useState<SmallBodyRecord[]>([]);
  const [catalogWarning, setCatalogWarning] = useState('');
  const [expanded, setExpanded] = useState<ExplorerGroup[]>(['planet']);
  const [search, setSearch] = useState('');
  const [searchToggles, setSearchToggles] = useState<ExplorerGroup[]>([]);
  const [remoteSearch, setRemoteSearch] = useState<SmallBodyRecord[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ephemeris, setEphemeris] = useState<{ key: string; data: EphemerisResult } | null>(null);
  const [ephemerisError, setEphemerisError] = useState('');
  const [retry, setRetry] = useState(0);
  const [focus, setFocus] = useState<{ id: string; azimuth: number; altitude: number; nonce: number } | null>(null);
  const [zoom, setZoom] = useState(70);
  const [view, setView] = useState({ azimuth: 180, altitude: 25, fov: 70 });
  const [constellations, setConstellations] = useState(true);
  const [grid, setGrid] = useState(false);
  const [landscape, setLandscape] = useState(true);
  const [showText, setShowText] = useState(true);
  const [meteors, setMeteors] = useState(true);
  const [selectedShowerId, setSelectedShowerId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [dialog, setDialog] = useState<'location' | 'time' | 'help' | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<ObserverLocation[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [timeError, setTimeError] = useState('');
  const [dateAnchor, setDateAnchor] = useState(() => new Date());
  const [timelineOffset, setTimelineOffset] = useState(0);
  const initialSelection = useRef(false);
  const objectSearchRef = useRef<HTMLInputElement>(null);
  const minimumZoom = mode === 'telescope' ? 0.15 : mode === 'binocular' ? 1 : 10;
  const pendingFocus = useRef<string | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  useEffect(() => { const query = window.matchMedia('(max-width: 760px)'); const update = () => setIsMobile(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  useEffect(() => { setZoom(previous => Math.max(previous, minimumZoom)); }, [minimumZoom]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable))) { event.preventDefault(); setSidebarOpen(true); requestAnimationFrame(() => objectSearchRef.current?.focus()); } };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => { try { localStorage.setItem('nocturne-location', JSON.stringify(observer)); } catch {} }, [observer]);
  useEffect(() => {
    const controller = new AbortController();
    getJson<StarRecord[]>('/data/stars.json', controller.signal).then(setStars).catch(e => { if (e.name !== 'AbortError') setStarWarning('Bright-star fallback active'); });
    getJson<{ objects: SmallBodyRecord[] }>('/api/catalog', controller.signal).then(data => setCatalog(data.objects)).catch(e => { if (e.name !== 'AbortError') setCatalogWarning('Small-body catalog unavailable. Try a name search.'); });
    getJson<{ satellites: SatelliteRecord[]; warning?: string }>('/api/satellites', controller.signal).then(data => { setSatellites(data.satellites); setSatelliteWarning(data.warning || (data.satellites.length ? '' : 'Satellite data is temporarily unavailable.')); }).catch(e => { if (e.name !== 'AbortError') setSatelliteWarning('Satellite data is temporarily unavailable.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!live && !playing) return;
    const timer = setInterval(() => {
      const monotonicNow = performance.now();
      const milliseconds = live ? clock.current!.setTime(Date.now(), monotonicNow, 1) : clock.current!.getTime(monotonicNow);
      setDate(new Date(milliseconds));
    }, 250);
    return () => clearInterval(timer);
  }, [live, playing]);
  const backgroundTime = live || playing ? Math.floor(date.getTime() / 5000) * 5000 : date.getTime();
  const calculatedDate = useMemo(() => new Date(backgroundTime), [backgroundTime]);
  const backgroundObjects = useMemo(() => computeSky(calculatedDate, observer, stars), [calculatedDate, observer, stars]);
  const satelliteObjects = useMemo(() => computeSatellites(date, observer, satellites), [date, observer, satellites]);
  const localObjects = useMemo(() => [...backgroundObjects, ...satelliteObjects], [backgroundObjects, satelliteObjects]);
  const minorBodies = useMemo(() => [...new Map([...catalog, ...remoteSearch].map(object => [object.id, object])).values()], [catalog, remoteSearch]);
  const selectedMinor = minorBodies.find(object => object.id === selectedId);
  const ephemerisKey = selectedMinor ? `${selectedMinor.id}|${observer.latitude}|${observer.longitude}|${observer.elevation}|${Math.floor(date.getTime() / 60000)}` : '';
  const currentEphemeris = ephemeris?.key === ephemerisKey ? ephemeris.data : null;
  useEffect(() => {
    setEphemerisError('');
    if (!selectedMinor) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ id: selectedMinor.id, lat: String(observer.latitude), lon: String(observer.longitude), elevation: String(observer.elevation), time: new Date(Math.floor(date.getTime() / 60000) * 60000).toISOString() });
      getJson<EphemerisResult>(`/api/ephemeris?${params}`, controller.signal).then(data => setEphemeris({ key: ephemerisKey, data })).catch(e => { if (e.name !== 'AbortError') setEphemerisError(e.message); });
    }, 450);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ephemerisKey, retry]);
  const objects = useMemo(() => currentEphemeris ? [...localObjects, { ...currentEphemeris.object, id: selectedMinor!.id }] : localObjects, [localObjects, currentEphemeris, selectedMinor]);
  const selected = objects.find(object => object.id === selectedId);
  const sunAltitude = useMemo(() => getSunAltitude(calculatedDate, observer), [calculatedDate, observer]);
  const moonPhase = useMemo(() => getMoonPhase(calculatedDate), [calculatedDate]);
  const visibility = selected ? getVisibility(selected, mode, sunAltitude) : null;
  const allShowers = useMemo(() => METEOR_SHOWERS.map(shower => showerInfo(shower, calculatedDate, observer)), [calculatedDate, observer]);
  const showers = useMemo(() => meteors ? allShowers.filter(x => x.active).sort((a, b) => b.strength - a.strength) : [], [meteors, allShowers]);
  const upcomingShower = useMemo(() => nextShower(calculatedDate), [calculatedDate]);
  const meteorRadiants = useMemo<MeteorRadiant[]>(() => {
    const stars = new Map(backgroundObjects.filter(x => x.category === 'star').map(x => [x.name, x]));
    return showers.map(({ shower, daysFromPeak, altitude, azimuth, strength }) => ({
      id: shower.id, name: shower.name, altitude, azimuth, strength, caption: peakLabel(daysFromPeak),
      guides: shower.guides.flatMap(name => { const star = stars.get(name); return star ? [{ name, altitude: star.altitude, azimuth: star.azimuth }] : []; }),
    }));
  }, [showers, backgroundObjects]);
  const selectedShower = allShowers.find(x => x.shower.id === selectedShowerId);
  const showerInView = !!selectedShower && selectedShower.active && selectedShower.altitude > 0 && sunAltitude < -12;
  const showerFollow = useMemo(() => selectedShower && !showerInView ? followTime(selectedShower, calculatedDate, observer) : null, [selectedShowerId, showerInView, calculatedDate, observer]);
  const pendingShowerFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingShowerFocus.current; if (!id) return;
    pendingShowerFocus.current = null;
    const info = allShowers.find(x => x.shower.id === id);
    if (info && info.altitude > 0) setFocus({ id: '', azimuth: info.azimuth, altitude: info.altitude, nonce: Date.now() });
  }, [allShowers]);
  const headlineShower = showers.find(x => Math.abs(x.daysFromPeak) <= 3);
  const moon = backgroundObjects.find(x => x.id === 'moon');
  useEffect(() => { if (!meteors) setSelectedShowerId(null); }, [meteors]);
  const selectShower = useCallback((id: string) => { setSelectedShowerId(id); setMeteors(true); setSidebarOpen(false); }, []);
  const toggleGroup = (id: ExplorerGroup) => (searchText ? setSearchToggles : setExpanded)(previous => previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id]);
  const minuteBucket = Math.floor(date.getTime() / 60000);
  const rise = useMemo(() => {
    if (selectedMinor) return currentEphemeris?.rise || null;
    if (!selected || selected.available === false || (selected.altitude >= 0 && (selected.category !== 'satellite' || selected.observable !== false))) return null;
    return getRiseEvent(selected, date, observer, satellites);
  }, [selectedId, minuteBucket, observer, satellites, currentEphemeris]);
  const focusObject = useCallback((object: SkyObject) => { if (object.available !== false && Number.isFinite(object.altitude) && object.altitude >= 0) setFocus({ id: object.id, azimuth: object.azimuth, altitude: object.altitude, nonce: Date.now() }); }, []);
  const selectObject = useCallback((id: string) => {
    setSelectedId(id); setSelectedShowerId(null); setDetailOpen(true); setSidebarOpen(false); setEphemerisError('');
    const object = objects.find(x => x.id === id);
    if (object) { focusObject(object); pendingFocus.current = null; } else pendingFocus.current = id;
  }, [objects, focusObject]);
  useEffect(() => {
    if (!initialSelection.current && localObjects.length) {
      initialSelection.current = true;
      const planet = localObjects.filter(x => x.category === 'planet' && x.id !== 'sun' && x.altitude > 8 && x.altitude < 50).sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99))[0] || localObjects.find(x => x.id === 'moon' && x.altitude > 0) || localObjects.find(x => x.name === 'Saturn') || localObjects[0];
      setSelectedId(planet.id);
    }
    if (selected && pendingFocus.current === selected.id) { focusObject(selected); pendingFocus.current = null; }
  }, [localObjects, selected, focusObject]);
  const setSimulationDate = (next: Date) => { clock.current!.setTime(next.getTime(), performance.now()); setLive(false); setPlaying(false); setDate(next); setTimelineOffset(0); setDateAnchor(next); };
  const jumpTonight = () => { const next = fromZonedInput(zonedInput(date, observer.timezone).slice(0, 10) + 'T22:00', observer.timezone); if (next) setSimulationDate(next); };
  const goLive = () => { const now = new Date(); clock.current!.setTime(now.getTime(), performance.now(), 1); setDate(now); setDateAnchor(now); setTimelineOffset(0); setPlaying(false); setLive(true); };
  const changeTimeStep = (seconds: number) => {
    if (!TIME_STEP_SECONDS.has(seconds) || latestTimeStep.current === seconds) return;
    latestTimeStep.current = seconds;
    setTimeStepSeconds(seconds);
    const monotonicNow = performance.now();
    if (live) {
      setDate(new Date(clock.current!.setTime(Date.now(), monotonicNow, seconds)));
      if (seconds !== 1) { setLive(false); setPlaying(true); }
    } else if (playing) setDate(new Date(clock.current!.setRate(seconds, monotonicNow)));
  };
  const readSelectedTimeStep = () => {
    const selected = Number(timeStepSelect.current?.value);
    const seconds = TIME_STEP_SECONDS.has(selected) ? selected : latestTimeStep.current;
    latestTimeStep.current = seconds;
    setTimeStepSeconds(seconds);
    return seconds;
  };
  const stepTime = (direction: -1 | 1) => {
    const seconds = readSelectedTimeStep();
    setSimulationDate(new Date(date.getTime() + direction * seconds * 1000));
  };
  const togglePlayback = () => {
    const seconds = readSelectedTimeStep();
    const monotonicNow = performance.now();
    if (live) clock.current!.setTime(Date.now(), monotonicNow, 1);
    setDate(new Date(clock.current!.setRate(playing ? 0 : seconds, monotonicNow)));
    setLive(false); setPlaying(!playing);
  };
  const visiblePlanets = localObjects.filter(x => x.category === 'planet' && x.id !== 'sun' && getVisibility(x, mode, sunAltitude).visible).length;
  const skyState = sunAltitude > 0 ? 'Daylight sky' : sunAltitude > -6 ? 'Civil twilight' : sunAltitude > -12 ? 'Nautical twilight' : sunAltitude > -18 ? 'Astronomical twilight' : 'Night sky';
  const timeZoneLabel = formatDate(date, observer.timezone, { timeZoneName: 'short' }).split(', ').pop()?.split(' ').pop() || observer.timezone;
  const readoutTimeZoneLabel = formatDate(readoutDate, observer.timezone, { timeZoneName: 'short' }).split(', ').pop()?.split(' ').pop() || observer.timezone;
  const selectedName = selected?.name || selectedMinor?.name;
  const showDetail = showText || detailOpen;
  const searchText = search.trim().toLowerCase();
  const groupedObjects = useMemo(() => {
    const groups: Record<Category, (SkyObject | SmallBodyRecord)[]> = { star: [], planet: [], moon: [], comet: [], asteroid: [], satellite: [] };
    for (const object of localObjects) {
      if (!searchText || object.name.toLowerCase().includes(searchText) || object.constellation?.toLowerCase().includes(searchText)) groups[object.category].push(object);
    }
    for (const group of Object.values(groups)) group.sort((a, b) => {
      const x = a as SkyObject, y = b as SkyObject;
      return (y.altitude >= 0 ? 1 : 0) - (x.altitude >= 0 ? 1 : 0) || (x.magnitude ?? 99) - (y.magnitude ?? 99);
    });
    for (const object of minorBodies) { if (!searchText || object.name.toLowerCase().includes(searchText)) groups[object.category].push(object); }
    return groups;
  }, [localObjects, minorBodies, searchText]);
  useEffect(() => setSearchToggles([]), [searchText]);
  const showerEntries = useMemo(() => allShowers
    .filter(({ shower }) => !searchText || shower.name.toLowerCase().includes(searchText) || shower.parent.toLowerCase().includes(searchText))
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.active ? b.strength - a.strength : a.peak.getTime() - b.peak.getTime())), [allShowers, searchText]);
  const searchSmallBodies = async () => {
    if (search.trim().length < 2) return;
    setSearchLoading(true); setSearchError('');
    try { const data = await getJson<{ objects: SmallBodyRecord[] }>(`/api/search?q=${encodeURIComponent(search.trim())}`); setRemoteSearch(previous => [...previous, ...data.objects]); setExpanded(previous => [...new Set([...previous, 'comet', 'asteroid'] as ExplorerGroup[])]); if (!data.objects.length) setSearchError('No matching small bodies. Try a designation, such as C/2023 A3.'); }
    catch (e) { setSearchError((e as Error).message); } finally { setSearchLoading(false); }
  };
  const applyLocation = (location: ObserverLocation) => { setObserver(location); setDialog(null); setLocationQuery(''); setLocationResults([]); if (selectedId) pendingFocus.current = selectedId; };
  const searchLocation = async (event: React.FormEvent) => {
    event.preventDefault(); setLocationLoading(true); setLocationError(''); setLocationResults([]);
    const match = locationQuery.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*[,; ]\s*([+-]?\d+(?:\.\d+)?)$/);
    if (match) {
      const latitude = Number(match[1]), longitude = Number(match[2]);
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { setLocationError('Use latitude −90 to 90 and longitude −180 to 180.'); setLocationLoading(false); return; }
      applyLocation({ name: `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`, latitude, longitude, elevation: 0, timezone: 'UTC' });
      setLocationLoading(false); return;
    }
    try { const data = await getJson<{ results: ObserverLocation[] }>(`/api/geocode?q=${encodeURIComponent(locationQuery)}`); setLocationResults(data.results); if (!data.results.length) setLocationError('No locations found. Try a nearby city or coordinates.'); }
    catch (e) { setLocationError((e as Error).message); } finally { setLocationLoading(false); }
  };
  const useDeviceLocation = () => {
    setLocationLoading(true); setLocationError('');
    if (!navigator.geolocation) { setLocationLoading(false); setLocationError('Geolocation is unavailable in this browser. Enter coordinates instead.'); return; }
    navigator.geolocation.getCurrentPosition(position => { applyLocation({ name: 'Your location', latitude: position.coords.latitude, longitude: position.coords.longitude, elevation: position.coords.altitude || 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setLocationLoading(false); }, () => { setLocationError('Location access was unavailable. Enter a city or coordinates instead.'); setLocationLoading(false); }, { timeout: 10000 });
  };

  return <div className={`observatory ${showText ? '' : 'minimal-ui'}`}>
    <SkyScene objects={objects} selectedId={showDetail ? selectedId : null} mode={mode} observer={observer} date={date} objectsDate={calculatedDate} timeRate={live ? 1 : playing ? timeStepSeconds : 0} constellations={constellations} grid={grid} landscape={landscape} focus={focus} zoom={zoom} onZoomChange={setZoom} onSelect={selectObject} onViewChange={setView} meteorRadiants={meteorRadiants} selectedShowerId={selectedShowerId} onSelectShower={selectShower} />
    <div className="sky-vignette" />
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Logo size={40} /></span><div><a href="/" className="wordmark" aria-label="Nocturne home">nocturne</a><p>YOUR PERSONAL OBSERVATORY</p></div></div>
      <button className="location-control" onClick={() => setDialog('location')}><MapPin size={15} /><span>{observer.name.split(',')[0]}</span><span className="location-coordinates">{Math.abs(observer.latitude).toFixed(2)}° {observer.latitude >= 0 ? 'N' : 'S'} &nbsp; {Math.abs(observer.longitude).toFixed(2)}° {observer.longitude >= 0 ? 'E' : 'W'}</span><ChevronDown size={13} /></button>
      <div className="header-actions"><span className="live-indicator"><i className={live ? 'is-live' : ''} />{live ? 'LIVE SKY' : 'TIME TRAVEL'}</span><button className="icon-button" aria-label={showText ? 'Hide extra text' : 'Show extra text'} aria-pressed={!showText} title={showText ? 'Hide extra text' : 'Show extra text'} onClick={() => setShowText(!showText)}>{showText ? <Eye size={19} /> : <EyeOff size={19} />}</button><button className={`icon-button ${settingsOpen ? 'active' : ''}`} aria-label="Sky display settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={19} /></button><button className="icon-button" aria-label="About Nocturne and data sources" onClick={() => setDialog('help')}><Info size={19} /></button></div>
    </header>

    <button className="mobile-explore" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <X size={17} /> : <Menu size={17} />} Explore the sky</button>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sky explorer" onClick={() => setSidebarOpen(false)} />}
    <aside className={`explorer ${sidebarOpen ? 'is-open' : ''}`} aria-label="Celestial object explorer" inert={isMobile && !sidebarOpen} aria-hidden={isMobile && !sidebarOpen}>
      <div className="explorer-heading"><span className="eyebrow">THE CELESTIAL COLLECTION</span><h1>Explore the sky<span>.</span></h1><p>A little perspective, a universe to find.</p></div>
      <label className="object-search"><Search size={15} /><input ref={objectSearchRef} value={search} onChange={e => { setSearch(e.target.value); setSearchError(''); }} placeholder="Find something above…" aria-label="Search celestial objects" />{search && <button aria-label="Clear object search" onClick={() => setSearch('')}><X size={13} /></button>}<kbd>/</kbd></label>
      <div className="category-list">
        {GROUPS.map(({ id, name, icon: Icon, subtitle }) => {
          const entries = groupedObjects[id]; const open = searchText ? (entries.length > 0) !== searchToggles.includes(id) : expanded.includes(id);
          return <section className={`category ${open ? 'expanded' : ''} ${searchText && !entries.length ? 'no-matches' : ''}`} key={id}>
            <button className="category-toggle" aria-expanded={open} onClick={() => toggleGroup(id)}><Icon size={17} strokeWidth={1.4} /><span>{name}</span><span className="category-count">{(id === 'planet' ? entries.filter(object => object.id !== 'sun').length : entries.length).toString().padStart(2, '0')}</span><ChevronDown size={13} className="category-chevron" /></button>
            <div className="category-content" inert={!open} aria-hidden={!open}><div className="category-content-inner"><p className="category-subtitle">{subtitle}</p>{entries.slice(0, id === 'star' ? 45 : 150).map(object => {
              const celestial = 'altitude' in object ? object as SkyObject : undefined;
              const positionAvailable = celestial && celestial.available !== false && Number.isFinite(celestial.altitude);
              const above = positionAvailable ? celestial.altitude >= 0 : false;
              const visible = celestial ? getVisibility(celestial, mode, sunAltitude).visible : false;
              return <button key={object.id} className={`object-row ${showDetail && selectedId === object.id ? 'selected' : ''}`} onClick={() => selectObject(object.id)}><span className={`object-dot ${id}`} style={{ '--object-color': celestial?.color || (id === 'comet' ? '#96c6c4' : '#8e969d') } as React.CSSProperties} /><span className="object-name">{object.name}{object.id === 'sun' && <small className="solar-reference"> · reference</small>}</span><span className={`object-status ${visible ? 'visible' : ''}`}>{celestial ? !positionAvailable ? 'No data' : above ? `${Math.round(celestial.altitude)}°` : 'Below' : <ArrowUpRight size={12} />}</span>{showDetail && selectedId === object.id && <span className="selected-mark" />}</button>;
            })}
            {id === 'star' && entries.length > 45 && <p className="collection-note">45 brightest of {entries.length.toLocaleString()} stars.<br />Search to explore the full catalog.</p>}
            {!entries.length && <p className="collection-note">{id === 'satellite' ? satelliteWarning || 'No satellites in the loaded catalog.' : searchText ? 'No matches in this collection.' : id === 'comet' || id === 'asteroid' ? catalogWarning || 'Loading the collection…' : 'No objects available.'}</p>}
            </div></div>
          </section>;
        })}
        {(() => {
          const open = searchText ? (showerEntries.length > 0) !== searchToggles.includes('meteor') : expanded.includes('meteor');
          return <section className={`category ${open ? 'expanded' : ''} ${searchText && !showerEntries.length ? 'no-matches' : ''}`}>
            <button className="category-toggle" aria-expanded={open} onClick={() => toggleGroup('meteor')}><MeteorIcon size={17} strokeWidth={1.4} /><span>Meteor showers</span><span className="category-count">{showerEntries.length.toString().padStart(2, '0')}</span><ChevronDown size={13} className="category-chevron" /></button>
            <div className="category-content" inert={!open} aria-hidden={!open}><div className="category-content-inner"><p className="category-subtitle">Dust trails we cross every year</p>{showerEntries.map(info => <button key={info.shower.id} className={`object-row ${selectedShowerId === info.shower.id ? 'selected' : ''}`} onClick={() => selectShower(info.shower.id)}><span className="object-dot meteor" style={{ '--object-color': info.active ? '#dfc69a' : '#8e969d' } as React.CSSProperties} /><span className="object-name">{info.shower.name}</span><span className={`object-status ${info.active && info.altitude > 0 && sunAltitude < -12 ? 'visible' : ''}`} title={info.active ? 'Active now · radiant altitude' : 'Next peak'}>{info.active ? info.altitude >= 0 ? `${Math.round(info.altitude)}°` : 'Below' : formatDate(info.peak, observer.timezone, { month: 'short', day: 'numeric' })}</span>{selectedShowerId === info.shower.id && <span className="selected-mark" />}</button>)}
            {!showerEntries.length && <p className="collection-note">No matches in this collection.</p>}
            </div></div>
          </section>;
        })()}
        {searchText.length >= 2 && <div className="remote-search"><button onClick={searchSmallBodies} disabled={searchLoading}>{searchLoading ? <LoaderCircle className="spin" size={14} /> : <Orbit size={14} />} Search NASA small bodies <ArrowUpRight size={13} /></button><p>Find a comet or asteroid by name or designation.</p>{searchError && <p className="inline-error" role="status">{searchError}</p>}</div>}
      </div>
      <div className="explorer-footer"><span className="tiny-dot" /><span>{starWarning || `${stars.length ? stars.length.toLocaleString() : 'Bright'} stars. Endless possibilities.`}</span><button aria-label="Catalog coverage and sources" onClick={() => setDialog('help')}><ArrowUpRight size={14} /></button></div>
    </aside>

    <section className="sky-heading" aria-label="Sky conditions"><div className="eyebrow"><span />{skyState.toUpperCase()}<span /></div><h2>Look up. Get lost.</h2><p>{visiblePlanets} {visiblePlanets === 1 ? 'planet' : 'planets'} in reach <i>·</i> {Math.round(moonPhase * 100)}% moon illumination{headlineShower && <> <i>·</i> {headlineShower.shower.name} {peakLabel(headlineShower.daysFromPeak).toLowerCase()}</>}</p>{sunAltitude > -6 && <button className="tonight-link" onClick={jumpTonight}>Meet the night <ArrowRight size={13} /></button>}</section>
    <section className="observing-panel" aria-label="Observation equipment"><span className="eyebrow">LOOK THROUGH</span><div className="observing-modes">{MODES.map(({ id, label, icon: Icon }) => <button key={id} className={mode === id ? 'active' : ''} aria-pressed={mode === id} aria-label={label} onClick={() => setMode(id)} title={id === 'telescope' ? 'Small telescope · ideal limiting magnitude 12' : label}><Icon size={18} strokeWidth={1.5} /><span className="mode-full">{label}</span><span className="mode-short">{id === 'eye' ? 'Eye' : id === 'binocular' ? 'Binos' : 'Scope'}</span></button>)}</div><p>To magnitude {modeMagnitudeLimit(mode)} <span>·</span> ideal dark-sky conditions</p></section>

    {settingsOpen && <div className="settings-popover"><div className="popover-title">Make the sky yours<button className="icon-button" aria-label="Close sky settings" onClick={() => setSettingsOpen(false)}><X size={15} /></button></div>{[{ name: 'Constellations', icon: Sparkles, value: constellations, set: setConstellations }, { name: 'Coordinate grid', icon: Globe2, value: grid, set: setGrid }, { name: 'Horizon landscape', icon: Mountain, value: landscape, set: setLandscape }, { name: 'Meteor showers', icon: MeteorIcon, value: meteors, set: setMeteors }].map(({ name, icon: Icon, value, set }) => <button className="setting-row" key={name} role="switch" aria-checked={value} onClick={() => set(!value)}><Icon size={16} /><span>{name}</span><i className={`switch ${value ? 'on' : ''}`} /></button>)}{meteors && <p className="meteor-summary">{showers.length ? `Active: ${showers.map(x => x.shower.name).join(', ')}` : `Next: ${upcomingShower.shower.name}, peak ${formatDate(upcomingShower.peak, observer.timezone, { month: 'short', day: 'numeric' })}`}</p>}<p>Drag to wander. Scroll to look closer.</p></div>}

    <div className="view-tools"><button className="compass-button" title="Look north" aria-label="Look north" onClick={() => setFocus({ id: '', azimuth: 0, altitude: 20, nonce: Date.now() })}><span>N</span><Compass size={35} strokeWidth={0.85} style={{ transform: `rotate(${-view.azimuth}deg)` }} /></button><div className="zoom-tools"><button aria-label="Zoom in" disabled={zoom <= minimumZoom} onClick={() => setZoom(Math.max(minimumZoom, zoom * 0.72))}><Plus size={17} /></button><span /><button aria-label="Zoom out" disabled={zoom >= 100} onClick={() => setZoom(Math.min(100, zoom / 0.72))}><Minus size={17} /></button></div><span className="fov-label">{zoom < 1 ? zoom.toFixed(2) : zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}° FOV</span></div>

    {(selected || selectedMinor) && showDetail && !selectedShower && <section className="object-detail" aria-label="Selected celestial object" aria-live="polite"><div className="detail-topline"><span className="eyebrow">{selected?.category || selectedMinor?.category} {selected?.constellation ? ` / ${selected.constellation}` : ' / SOLAR SYSTEM'}</span><span className={`detail-visibility ${visibility?.visible ? 'is-visible' : ''}`}><i />{selected ? selected.available === false ? 'Position unavailable' : selected.altitude < 0 ? 'Below horizon' : visibility?.visible ? 'In your sky' : 'Above horizon' : 'Looking it up'}</span>{!showText && <button className="icon-button detail-close" aria-label="Close object details" onClick={() => setDetailOpen(false)}><X size={14} /></button>}</div><div className="detail-title"><h2>{selectedName}</h2><div className={`planet-portrait portrait-${(selected?.name || '').toLowerCase()}`} style={{ '--planet-color': selected?.color || '#c1b7a0' } as React.CSSProperties}><span /></div></div><p className="detail-description">{selected?.description || selectedMinor?.description || 'A distant world, waiting to be found.'}</p>
      {selected ? <><div className="object-metrics"><div><span>ALTITUDE</span><strong>{Number.isFinite(selected.altitude) ? selected.altitude.toFixed(1) : '—'}<small>°</small></strong></div><div><span>AZIMUTH</span><strong>{Number.isFinite(selected.azimuth) ? selected.azimuth.toFixed(0) : '—'}<small>° {Number.isFinite(selected.azimuth) ? cardinalDirection(selected.azimuth) : ''}</small></strong></div><div><span>MAGNITUDE</span><strong>{selected.magnitude === null ? '—' : selected.magnitude.toFixed(1)}</strong></div></div>{(selected.warning || (!visibility?.visible && selected.altitude >= 0)) && <p className="visibility-note">{selected.warning || visibility?.reason}</p>}<div className="detail-bottom"><button className="focus-button" onClick={() => { if (selected.available !== false && selected.altitude >= 0) focusObject(selected); else if (rise) { const next = new Date(new Date(rise.time).getTime() + (rise.kind === 'pass' ? 20000 : 5 * 60000)); pendingFocus.current = selected.id; setSimulationDate(next); } }} disabled={selected.available === false || (selected.altitude < 0 && !rise)}><Crosshair size={14} />{selected.available === false ? 'Position unavailable' : selected.altitude >= 0 ? 'Center in sky' : rise ? (rise.kind === 'pass' ? 'See next pass' : 'See it rise') : 'Below horizon'}</button>{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer" title={selected.source}>Source <ArrowUpRight size={12} /></a> : <span className="detail-source">{selected.source}</span>}</div></> : <div className="ephemeris-state">{ephemerisError ? <><p className="inline-error">{ephemerisError}</p><button className="text-button" onClick={() => setRetry(x => x + 1)}>Try again <ArrowRight size={13} /></button></> : <><LoaderCircle size={17} className="spin" /><span>Finding its position with NASA JPL…</span></>}</div>}
    </section>}

    {selectedShower && <section className="object-detail shower-detail" aria-label="Selected meteor shower" aria-live="polite"><div className="detail-topline"><span className="eyebrow">METEOR SHOWER / PEAK {formatDate(selectedShower.peak, observer.timezone, { month: 'short', day: 'numeric' }).toUpperCase()}</span><span className={`detail-visibility ${showerInView ? 'is-visible' : ''}`}><i />{!selectedShower.active ? 'Not active now' : selectedShower.altitude <= 0 ? 'Radiant below horizon' : sunAltitude < -12 ? 'Look up now' : 'Wait for darkness'}</span><button className="icon-button detail-close" aria-label="Close meteor shower details" onClick={() => setSelectedShowerId(null)}><X size={14} /></button></div>
      <div className="detail-title"><h2>{selectedShower.shower.name}</h2><span className="meteor-portrait"><MeteorIcon size={26} strokeWidth={1.4} /></span></div>
      <p className="detail-description shower-finder"><strong>Where to look.</strong> {selectedShower.shower.finder} Meteors appear anywhere in the sky; their trails point back here.</p>
      <div className="object-metrics">{selectedShower.active ? <><div><span>RADIANT ALT</span><strong>{selectedShower.altitude.toFixed(1)}<small>°</small></strong></div><div><span>AZIMUTH</span><strong>{selectedShower.azimuth.toFixed(0)}<small>° {cardinalDirection(selectedShower.azimuth)}</small></strong></div></> : <><div><span>ACTIVE FROM</span><strong className="metric-date">{formatDate(new Date(selectedShower.peak.getTime() + selectedShower.shower.start * 86_400_000), observer.timezone, { month: 'short', day: 'numeric' })}</strong></div><div><span>PEAK</span><strong className="metric-date">{formatDate(selectedShower.peak, observer.timezone, { month: 'short', day: 'numeric' })}</strong></div></>}<div><span>PEAK RATE</span><strong>{selectedShower.shower.zhr}<small>/hr</small></strong></div></div>
      <p className="visibility-note">{selectedShower.active ? peakLabel(selectedShower.daysFromPeak) : `Next peak ${formatDate(selectedShower.peak, observer.timezone, { weekday: 'long', month: 'long', day: 'numeric' })}`}. {selectedShower.active && moon && moon.altitude > 0 && moonPhase > 0.5 ? `The ${Math.round(moonPhase * 100)}% Moon is up and will hide fainter meteors.` : selectedShower.shower.note || `Debris from ${selectedShower.shower.parent}.`}</p>
      <div className="detail-bottom"><button className="focus-button" disabled={!showerInView && !showerFollow} title={showerFollow ? `Travel to ${formatDate(showerFollow.time, observer.timezone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, when the radiant is highest in a dark sky` : undefined} onClick={() => { if (showerInView) setFocus({ id: '', azimuth: selectedShower.azimuth, altitude: selectedShower.altitude, nonce: Date.now() }); else if (showerFollow) { pendingShowerFocus.current = selectedShower.shower.id; setSimulationDate(showerFollow.time); } }}><Crosshair size={14} />{showerInView ? 'Center radiant' : showerFollow ? selectedShower.active ? `See it ${formatDate(showerFollow.time, observer.timezone, { hour: 'numeric', minute: '2-digit' })}` : 'Go to peak night' : 'Not visible from here'}</button><a href="https://www.imo.net/resources/calendar/" target="_blank" rel="noreferrer" title="International Meteor Organization">IMO calendar <ArrowUpRight size={12} /></a></div>
    </section>}
    {selected && showDetail && !selectedShower && selected.available !== false && (selected.altitude < 0 || (selected.category === 'satellite' && selected.observable === false)) && <div className="rise-banner"><div className="rise-direction"><ArrowUpRight size={22} style={{ transform: `rotate(${(rise?.azimuth || selected.azimuth) - 45}deg)` }} /></div><div><span className="eyebrow">{rise ? `LOOK ${cardinalDirection(rise.azimuth).toUpperCase()} · ${Math.round(rise.azimuth)}°` : 'BEYOND YOUR HORIZON'}</span><p>{selected.name} {rise ? <>{rise.kind === 'pass' ? 'pass begins in' : 'rises in'} <strong>{countdown(rise.time, date)}</strong></> : (selected.category === 'satellite' ? 'has no predicted visible pass in the forecast window' : 'does not rise in the forecast window')}</p></div>{rise && <button onClick={() => { pendingFocus.current = selected.id; setSimulationDate(new Date(new Date(rise.time).getTime() + (rise.kind === 'pass' ? 20000 : 5 * 60000))); }}><span className="rise-time-full">{formatDate(new Date(rise.time), observer.timezone, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</span><span className="rise-time-compact">{formatDate(new Date(rise.time), observer.timezone, { hour: 'numeric', minute: '2-digit' })} {timeZoneLabel}</span><ArrowRight size={15} /></button>}</div>}

    <div className="sky-coordinate-readout"><span className="crosshair-small">+</span><span>{cardinalDirection(view.azimuth)} &nbsp; {Math.round(view.azimuth)}°</span><i /> <span>ALT {Math.round(view.altitude)}°</span></div>
    <footer className="time-console">
      <div className="timeline-top"><label className="time-step"><span>Step / speed</span><select ref={timeStepSelect} aria-label="Time step" title="Arrow step and playback speed: this much simulated time passes each real second" value={timeStepSeconds} onInput={e => changeTimeStep(Number(e.currentTarget.value))} onChange={e => changeTimeStep(Number(e.currentTarget.value))}><option value={3600}>1h</option><option value={1800}>30m</option><option value={300}>5m</option><option value={60}>1m</option><option value={30}>30s</option><option value={10}>10s</option><option value={5}>5s</option><option value={1}>1s</option></select></label><button onClick={jumpTonight}>Tonight, 10 pm <ArrowUpRight size={12} /></button></div>
      <div className="time-main"><button className={`date-display ${showSeconds ? 'with-seconds' : ''}`} onClick={() => { setTimeInput(zonedInput(date, observer.timezone)); setTimeError(''); setDialog('time'); }}><span>{formatDate(readoutDate, observer.timezone, { month: 'short', day: 'numeric', year: 'numeric' })}{showSeconds && <small>{readoutTimeZoneLabel}</small>}</span><strong>{formatDate(readoutDate, observer.timezone, { hour: '2-digit', minute: '2-digit', second: showSeconds ? '2-digit' : undefined, hour12: false })}{!showSeconds && <small>{readoutTimeZoneLabel}</small>}</strong><ChevronDown size={12} /></button><div className="time-transport"><button className="icon-button" aria-label={`Go back ${timeStepLabel}`} title={`Back ${timeStepLabel}`} onClick={() => stepTime(-1)}><ChevronLeft size={18} /></button><button className={`play-button ${playing ? 'playing' : ''}`} aria-label={playing ? 'Pause time' : `Play time at ${timeStepSeconds} times normal speed`} title={`${playing ? 'Pause' : 'Play'} time · ${timeStepLabel} per real second (${timeStepSeconds}×)`} onClick={togglePlayback}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><button className="icon-button" aria-label={`Go forward ${timeStepLabel}`} title={`Forward ${timeStepLabel}`} onClick={() => stepTime(1)}><ChevronRight size={18} /></button></div><button className={`live-button ${live ? 'active' : ''}`} onClick={goLive} title="Return to the live sky" aria-label="Return to the live sky"><span />NOW</button></div>
      <div className="timeline-range"><span>−12h</span><div className="timeline-track"><div className="timeline-ticks" /><input type="range" min={-720} max={720} step={5} value={timelineOffset} aria-label="Move time up to twelve hours from the chosen moment" onPointerDown={() => { if (live || playing) { const paused = new Date(clock.current!.setRate(0, performance.now())); setDate(paused); setDateAnchor(paused); setTimelineOffset(0); } setLive(false); setPlaying(false); }} onChange={e => { const offset = Number(e.target.value); const next = new Date(dateAnchor.getTime() + offset * 60000); clock.current!.setTime(next.getTime(), performance.now()); setLive(false); setPlaying(false); setTimelineOffset(offset); setDate(next); }} /></div><span>+12h</span></div>
    </footer>
    <div className="bottom-note"><span>EARTH IS JUST THE BEGINNING</span><span>Drag to explore <i>·</i> Scroll to zoom</span></div>

    {dialog === 'location' && <Modal title="Where are you looking up?" onClose={closeDialog}><p className="modal-intro">Every place has its own piece of the universe.</p><form onSubmit={searchLocation}><label className="field-label" htmlFor="location-query">CITY OR LATITUDE, LONGITUDE</label><div className="location-search-field"><MapPin size={17} /><input id="location-query" value={locationQuery} onChange={e => setLocationQuery(e.target.value)} placeholder="Paris, or 48.8566, 2.3522" required /><button type="submit" disabled={locationLoading || !locationQuery.trim()}>{locationLoading ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={18} />}</button></div></form>{locationError && <p className="inline-error" role="alert">{locationError}</p>}<div className="location-results">{locationResults.map((location, i) => <button key={`${location.name}-${i}`} onClick={() => applyLocation(location)}><MapPin size={15} /><span><strong>{location.name}</strong><small>{location.latitude.toFixed(3)}°, {location.longitude.toFixed(3)}° · {location.timezone}</small></span><ArrowRight size={14} /></button>)}</div><button className="device-location" onClick={useDeviceLocation} disabled={locationLoading}><LocateFixed size={16} /> Use my current location</button><p className="field-hint">Coordinates work offline and use UTC for date and time. City search supplies the local time zone.</p><div className="current-location"><span className="eyebrow">CURRENT OBSERVATORY</span><p>{observer.name}</p><span>{observer.timezone}</span></div></Modal>}
    {dialog === 'time' && <Modal title="Choose your moment." onClose={closeDialog}><p className="modal-intro">Look ahead to tonight, or visit a sky from another time.</p><form onSubmit={e => { e.preventDefault(); const submittedTime = String(new FormData(e.currentTarget).get('observationTime') || timeInput); const parsed = fromZonedInput(submittedTime, observer.timezone); if (parsed) { setSimulationDate(parsed); closeDialog(); } else setTimeError('This local time does not exist, usually because of daylight saving time. Choose another time.'); }}><label className="field-label" htmlFor="observation-time">DATE & TIME · {observer.timezone.replaceAll('_', ' ')}</label><input className="datetime-field" id="observation-time" name="observationTime" type="datetime-local" value={timeInput} onInput={e => setTimeInput(e.currentTarget.value)} onChange={e => setTimeInput(e.target.value)} required min="1900-01-01T00:00" max="2100-12-31T23:59" />{timeError && <p className="inline-error" role="alert">{timeError}</p>}<button className="primary-button" type="submit">Travel to this sky <ArrowRight size={16} /></button></form><p className="field-hint">Planet and star positions follow the selected time. Satellite predictions are only reliable near the date of their current orbital elements.</p></Modal>}
    {dialog === 'help' && <Modal title="A sky worth getting lost in." onClose={closeDialog} wide><p className="modal-intro">Nocturne turns public astronomical data into your personal view of the sky.</p><div className="help-section"><h3>Make yourself at home</h3><p>Drag the sky to look around. Scroll or pinch to zoom. When the sky has keyboard focus, use the arrow keys to pan and + / − to zoom. Choose an object to find it; objects below the horizon show their next rise when one can be calculated.</p></div><div className="help-section"><h3>Choose how you observe</h3><p>Naked eye, binoculars, and a small telescope reveal progressively fainter objects. These are ideal dark-sky magnitude limits, not guarantees of visibility. Twilight, light pollution, weather, object size, and equipment all matter. Never look at the Sun through binoculars or a telescope without a suitable solar filter.</p></div><div className="help-section"><h3>A real sky, with honest limits</h3><div className="source-links"><a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noreferrer">Astronomy Engine<span>Planet & Moon positions <ArrowUpRight size={13} /></span></a><a href="https://github.com/astronexus/HYG-Database" target="_blank" rel="noreferrer">HYG star database<span>Star catalog & magnitudes <ArrowUpRight size={13} /></span></a><a href="https://github.com/ofrohn/d3-celestial" target="_blank" rel="noreferrer">D3 Celestial<span>Constellation lines <ArrowUpRight size={13} /></span></a><a href="/data/ATTRIBUTION.md" target="_blank" rel="noreferrer">Catalog attribution<span>Credits &amp; licenses <ArrowUpRight size={13} /></span></a><a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noreferrer">NASA JPL Horizons & SBDB<span>Comet & asteroid ephemerides <ArrowUpRight size={13} /></span></a><a href="https://www.imo.net/resources/calendar/" target="_blank" rel="noreferrer">International Meteor Organization<span>Meteor shower dates &amp; radiants <ArrowUpRight size={13} /></span></a><a href="https://celestrak.org/" target="_blank" rel="noreferrer">CelesTrak<span>Satellite orbital elements <ArrowUpRight size={13} /></span></a><a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noreferrer">Open-Meteo<span>City search & time zones <ArrowUpRight size={13} /></span></a></div><p>The HYG catalog includes stars through magnitude 9, even in telescope mode. The star list shows the brightest matches first. The small-body collection is curated; use NASA search to find additional objects. Satellite coverage is a limited public catalog, and sunlight and brightness determine whether a pass is visible. Comet brightness predictions are uncertain. Positions are calculated without weather or local obstructions. The landscape is illustrative, not a model of your local terrain.</p>{satelliteWarning && <p className="data-warning">{satelliteWarning}</p>}{starWarning && <p className="data-warning">{starWarning}</p>}</div><div className="help-signoff"><Logo size={28} /><span>A little perspective changes everything.</span></div></Modal>}
  </div>;
}
