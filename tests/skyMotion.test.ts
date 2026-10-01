import assert from 'node:assert/strict';
import test from 'node:test';
import { InverseRefraction } from 'astronomy-engine';
import { Quaternion, Vector3 } from 'three';
import { equatorialToHorizontal } from '../src/lib/astronomy';
import { skyRotation, updateSkyClock, type SkyClockSample } from '../src/lib/skyMotion';

const RAD = Math.PI / 180;
function geometricDirection(position: {azimuth:number;altitude:number}) {
  const az=position.azimuth*RAD;
  const alt=(position.altitude+InverseRefraction('normal',position.altitude))*RAD;
  return new Vector3(Math.sin(az)*Math.cos(alt),Math.sin(alt),-Math.cos(az)*Math.cos(alt));
}

test('frame-rate sky rotation agrees with independently recalculated celestial directions in both hemispheres', () => {
  const start=new Date('2026-09-30T02:00:00Z');
  for(const latitude of [40.7128,-33.8688]) {
    const observer={name:'Test',latitude,longitude:151.2093,elevation:0,timezone:'UTC'};
    for(const [ra,dec] of [[6.7525,-16.7161],[18.6156,38.7837]]) {
      const before=geometricDirection(equatorialToHorizontal(ra,dec,start,observer));
      for(const elapsedMs of [1000,10000,3600000]) {
        const predicted=before.clone().applyQuaternion(skyRotation(latitude,elapsedMs,new Quaternion()));
        const actual=geometricDirection(equatorialToHorizontal(ra,dec,new Date(start.getTime()+elapsedMs),observer));
        // Refraction is removed before comparison: it does not rotate rigidly.
        assert.ok(predicted.angleTo(actual)/RAD<0.0001,`${latitude}°, ${ra}h, ${elapsedMs}ms`);
      }
    }
  }
});

test('paused sky has no rotation and reverse time exactly undoes forward motion', () => {
  const position=new Vector3(0.4,0.7,-0.3).normalize();
  const still=position.clone().applyQuaternion(skyRotation(51.5,0,new Quaternion()));
  assert.ok(position.distanceTo(still)<1e-12);
  const reversed=position.clone().applyQuaternion(skyRotation(51.5,10000,new Quaternion())).applyQuaternion(skyRotation(51.5,-10000,new Quaternion()));
  assert.ok(position.distanceTo(reversed)<1e-12);
});

const visualTime=(sample:SkyClockSample,now:number) => sample.simulatedMs+Math.max(0,now-sample.monotonicMs)*sample.rate;

test('5× and 10× playback never rewind when fresh positions take different amounts of time to calculate', () => {
  for(const rate of [5,10]) {
    let sample:SkyClockSample={simulatedMs:0,monotonicMs:5,rate};
    for(let tick=1;tick<=40;tick++) {
      const simulatedMs=tick*250*rate;
      const deliveredAt=tick*250+(tick%2===0?45:5);
      const before=visualTime(sample,deliveredAt);
      const next=updateSkyClock(sample,simulatedMs,rate,deliveredAt);
      assert.equal(next.continuous,true);
      assert.ok(Math.abs(visualTime(next.sample,deliveredAt)-before)<1e-8,`${rate}× tick ${tick} changed visual time on receipt`);
      assert.equal(next.sample.monotonicMs,tick*250+5,'sample anchor must follow simulation time, independent of calculation delay');
      sample=next.sample;
    }
  }
});

test('visual clock resets for seeks, rate changes, pauses and a changed observer', () => {
  const initial={simulatedMs:10000,monotonicMs:1000,rate:5};
  for(const [date,rate,reset] of [[3600000,5,false],[11250,10,false],[11250,0,false],[11250,5,true]] as const) {
    const next=updateSkyClock(initial,date,rate,1290,reset);
    assert.equal(next.continuous,false);
    assert.deepEqual(next.sample,{simulatedMs:date,monotonicMs:1290,rate});
    assert.equal(visualTime(next.sample,1290),date);
  }
  const unchanged=updateSkyClock(initial,initial.simulatedMs,initial.rate,1200);
  assert.equal(unchanged.sample,initial,'unrelated UI refresh must preserve the clock');
});
