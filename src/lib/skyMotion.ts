import { Quaternion, Vector3 } from 'three';

const RAD = Math.PI / 180;
const SIDEREAL_DAY_MS = 86164090.5;

/** Rotate a sampled horizontal sky about the observer's celestial north pole. */
export function skyRotation(latitude: number, elapsedMs: number, target: Quaternion) {
  return target.setFromAxisAngle(new Vector3(0, Math.sin(latitude * RAD), -Math.cos(latitude * RAD)), -elapsedMs / SIDEREAL_DAY_MS * Math.PI * 2);
}

export interface SkyClockSample { simulatedMs: number; monotonicMs: number; rate: number }

/** Keep calculation latency out of the visual clock while accepting fresh positions. */
export function updateSkyClock(previous: SkyClockSample, simulatedMs: number, rate: number, monotonicNow: number, reset = false) {
  if(!reset && simulatedMs===previous.simulatedMs && rate===previous.rate) return {sample:previous,continuous:false};
  const interval=simulatedMs-previous.simulatedMs;
  const expected=(monotonicNow-previous.monotonicMs)*previous.rate;
  const continuous=!reset && rate===previous.rate && rate>0 && interval>0 && Math.abs(interval-expected)<Math.max(2000,Math.abs(expected)*0.35);
  return {
    sample:{simulatedMs,rate,monotonicMs:continuous ? previous.monotonicMs+interval/rate : monotonicNow},
    continuous,
  };
}
