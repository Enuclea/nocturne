import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationClock } from '../src/lib/simulation-clock';

const start = Date.parse('2026-09-30T23:22:20Z');

test('each selected step advances playback by that many simulated seconds per real second', () => {
  for (const seconds of [1, 5, 10, 30, 60, 300, 1800, 3600]) {
    const clock = new SimulationClock(start, 100, seconds);
    for (const elapsed of [250, 500, 750, 1000, 5000]) {
      assert.equal(clock.getTime(100 + elapsed), start + elapsed * seconds, `${seconds}s step after ${elapsed}ms`);
    }
  }
});

test('delayed and irregular timer callbacks preserve elapsed time without fixed jumps or drift', () => {
  const clock = new SimulationClock(start, 500, 5);
  for (const elapsed of [247, 531, 2029, 7537, 60123]) {
    assert.equal(clock.getTime(500 + elapsed), start + elapsed * 5);
  }
});

test('changing speed accounts for elapsed time at the old rate before using the new rate', () => {
  const clock = new SimulationClock(start, 0, 1);
  assert.equal(clock.setRate(30, 1125), start + 1125);
  assert.equal(clock.getTime(2125), start + 31125);
  assert.equal(clock.setRate(5, 2250), start + 34875);
  assert.equal(clock.getTime(3250), start + 39875);
});

test('pause and resume preserve the exact moment and exclude time spent paused', () => {
  const clock = new SimulationClock(start, 0, 10);
  const paused = clock.setRate(0, 375);
  assert.equal(paused, start + 3750);
  assert.equal(clock.getTime(15000), paused);
  assert.equal(clock.setRate(10, 20000), paused);
  assert.equal(clock.getTime(20250), paused + 2500);
});

test('seeking stops playback and returning live resets the time and rate', () => {
  const clock = new SimulationClock(start, 0, 3600);
  const selected = start + 1000;
  assert.equal(clock.setTime(selected, 250), selected);
  assert.equal(clock.getTime(9000), selected);
  const live = start + 80000;
  assert.equal(clock.setTime(live, 9000, 1), live);
  assert.equal(clock.getTime(9250), live + 250);
});

test('the readout advances by the selected step once per real second while sky time stays continuous', () => {
  for (const seconds of [1, 5, 10, 30, 60, 300, 1800, 3600]) {
    const clock = new SimulationClock(start, 100, seconds);
    for (const elapsed of [-50, 0, 250, 500, 750, 999, 1000, 1250, 1999, 2000]) {
      const expectedElapsed = Math.max(0, elapsed);
      assert.equal(clock.getDisplayTime(100 + elapsed), start + Math.floor(expectedElapsed / 1000) * 1000 * seconds, `${seconds}s readout after ${elapsed}ms`);
      assert.equal(clock.getTime(100 + elapsed), start + expectedElapsed * seconds, `${seconds}s sky after ${elapsed}ms`);
    }
  }
});

test('readout ticks remain anchored when timer callbacks are delayed or irregular', () => {
  const clock = new SimulationClock(start, 500, 10);
  for (const elapsed of [247, 1007, 2029, 7537, 60123, 60999, 61000]) {
    assert.equal(clock.getDisplayTime(500 + elapsed), start + Math.floor(elapsed / 1000) * 10000);
  }
});

test('changing speed reanchors the readout at the exact current time', () => {
  const clock = new SimulationClock(start, 100, 5);
  assert.equal(clock.getDisplayTime(1850), start + 5000);
  const changed = clock.setRate(10, 1850);
  assert.equal(changed, start + 8750);
  assert.equal(clock.getDisplayTime(1850), changed);
  assert.equal(clock.getDisplayTime(2849), changed);
  assert.equal(clock.getDisplayTime(2850), changed + 10000);
  assert.equal(clock.getTime(2100), changed + 2500);
});

test('pause, resume, and seek show the exact new moment without retaining old display ticks', () => {
  const clock = new SimulationClock(start, 100, 10);
  const paused = clock.setRate(0, 475);
  assert.equal(paused, start + 3750);
  assert.equal(clock.getDisplayTime(475), paused);
  assert.equal(clock.getDisplayTime(9000), paused);
  clock.setRate(5, 10000);
  assert.equal(clock.getDisplayTime(10999), paused);
  assert.equal(clock.getDisplayTime(11000), paused + 5000);
  const selected = start - 60000;
  clock.setTime(selected, 11250);
  assert.equal(clock.getDisplayTime(11250), selected);
  assert.equal(clock.getDisplayTime(15000), selected);
  clock.setTime(start + 90000, 16000, 10);
  assert.equal(clock.getDisplayTime(16999), start + 90000);
  assert.equal(clock.getDisplayTime(17000), start + 100000);
});
