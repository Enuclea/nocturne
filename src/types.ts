export type Category = 'star' | 'planet' | 'moon' | 'comet' | 'asteroid' | 'satellite';
export type ObservingMode = 'eye' | 'binocular' | 'telescope';
export interface ObserverLocation { name: string; latitude: number; longitude: number; elevation: number; timezone: string; }
export interface SkyObject {
  id: string; name: string; category: Category;
  altitude: number; azimuth: number; ra: number; dec: number;
  magnitude: number | null; color: string; description: string;
  distance?: string; phase?: number; constellation?: string;
  source: string; sourceUrl?: string; warning?: string; available?: boolean;
  observable?: boolean; epoch?: string;
}
export interface RiseEvent { time: string; azimuth: number; kind: 'rise' | 'pass'; }
export interface StarRecord { id: string; name: string; ra: number; dec: number; magnitude: number; bv?: number; constellation?: string; pmra?: number; pmdec?: number; }
export interface ConstellationLine { name: string; points: [number, number][]; }
export interface SatelliteRecord { name: string; line1: string; line2: string; }
export interface SmallBodyRecord { id: string; name: string; category: 'comet' | 'asteroid'; description: string; }
export interface EphemerisResult { object: SkyObject; rise: RiseEvent | null; sampledAt: string; source: string; }
export interface MeteorRadiant { id: string; name: string; altitude: number; azimuth: number; strength: number; caption: string; guides: { name: string; altitude: number; azimuth: number }[]; }
export interface SkySceneProps {
  objects: SkyObject[]; selectedId: string | null; mode: ObservingMode;
  observer: ObserverLocation; date: Date; objectsDate: Date; timeRate: number; constellations: boolean; grid: boolean;
  landscape: boolean; focus: { id: string; azimuth: number; altitude: number; nonce: number } | null;
  zoom: number; onZoomChange: (zoom: number) => void; onSelect: (id: string) => void;
  onViewChange?: (view: { azimuth: number; altitude: number; fov: number }) => void;
  meteorRadiants: MeteorRadiant[]; selectedShowerId: string | null; onSelectShower: (id: string) => void;
}
