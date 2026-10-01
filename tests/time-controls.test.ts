import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

interface SkySnapshot { date: Date; timeRate: number; }
interface AppFixture {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  mount: (element: Element) => { unmount: () => void };
}

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const wallStart = Date.parse('2026-09-30T23:22:20Z');

// Bundle the actual App and React DOM together so their event handling is tested.
// Only the WebGL component is replaced; its props expose the time sent to the sky.
async function buildFixture(directory: string) {
  const result = await build({
    stdin: {
      contents: `
        import { act } from 'react';
        import { createRoot } from 'react-dom/client';
        import App from './src/App';
        export { act };
        export function mount(element) {
          const root = createRoot(element);
          root.render(<App />);
          return root;
        }
      `,
      loader: 'tsx',
      resolveDir: projectDirectory,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{
      name: 'expose-sky-clock',
      setup(build) {
        build.onResolve({ filter: /components\/SkyScene$/ }, () => ({ path: 'sky-clock', namespace: 'test' }));
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export default function SkyScene(props) { globalThis.__nocturneClockTestProps = props; return null; }',
          loader: 'js',
        }));
      },
    }],
  });
  const filename = path.join(directory, 'app-fixture.mjs');
  await writeFile(filename, result.outputFiles[0].text);
  return filename;
}

async function withApp(t: TestContext, fixturePath: string, run: (app: {
  act: AppFixture['act'];
  select: HTMLSelectElement;
  event: (name: string) => Event;
  play: () => HTMLButtonElement;
  sky: () => SkySnapshot;
  readout: () => string;
  elapse: (milliseconds: number) => void;
  tick: (milliseconds: number) => Promise<void>;
  pauseAt: (seconds: number) => Promise<void>;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  let monotonic = 0;
  let nextInterval = 0;
  const intervals = new Map<number, () => void>();
  const channels: MessageChannel[] = [];
  let mounted: { unmount: () => void } | undefined;
  let fixture: AppFixture | undefined;
  try {
    dom.window.matchMedia = query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
    for (const name of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent']) {
      setGlobal(name, name === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
    }
    setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setGlobal('MessageChannel', class extends MessageChannel { constructor() { super(); channels.push(this); } });
    setGlobal('__nocturneClockTestProps', undefined);
    setGlobal('setInterval', (callback: () => void) => { intervals.set(++nextInterval, callback); return nextInterval; });
    setGlobal('clearInterval', (id: number) => { intervals.delete(id); });
    setGlobal('fetch', async (url: string) => ({
      ok: true,
      json: async () => url.includes('/data/stars') ? [] : url.includes('/satellites') ? { satellites: [] } : { objects: [] },
    }));
    t.mock.method(performance, 'now', () => monotonic);
    t.mock.method(Date, 'now', () => wallStart + monotonic);
    fixture = await import(`${pathToFileURL(fixturePath).href}?case=${encodeURIComponent(t.name)}`) as AppFixture;
    await fixture.act(async () => { mounted = fixture!.mount(dom.window.document.getElementById('app')!); });
    const select = dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Time step"]')!;
    assert.ok(select);
    const event = (name: string) => new dom.window.Event(name, { bubbles: true });
    const play = () => dom.window.document.querySelector<HTMLButtonElement>('.play-button')!;
    const sky = () => (globalThis as unknown as { __nocturneClockTestProps: SkySnapshot }).__nocturneClockTestProps;
    const readout = () => dom.window.document.querySelector('.date-display strong')!.textContent!;
    const elapse = (milliseconds: number) => { monotonic += milliseconds; };
    const tick = async (milliseconds: number) => {
      elapse(milliseconds);
      await fixture!.act(async () => { for (const callback of [...intervals.values()]) callback(); });
    };
    const pauseAt = async (seconds: number) => {
      await fixture!.act(async () => {
        select.value = '1';
        select.dispatchEvent(event('input'));
        select.dispatchEvent(event('change'));
      });
      await fixture!.act(async () => {
        dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Go forward 1 second"]')!.click();
      });
      await fixture!.act(async () => {
        select.value = String(seconds);
        select.dispatchEvent(event('input'));
        select.dispatchEvent(event('change'));
      });
      assert.equal(sky().timeRate, 0);
    };
    await run({ act: fixture.act, select, event, play, sky, readout, elapse, tick, pauseAt });
  } finally {
    if (mounted && fixture) await fixture.act(async () => mounted!.unmount());
    dom.window.close();
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    t.mock.restoreAll();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('time controls preserve selected rates and readable playback cadence', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nocturne-time-controls-'));
  try {
    const fixturePath = await buildFixture(directory);
    await t.test('paused 1s → input-only 5s → immediate Play runs at 5×', async t => {
      await withApp(t, fixturePath, async app => {
        await app.pauseAt(1);
        const start = app.sky().date.getTime();
        await app.act(async () => {
          app.select.value = '5';
          app.select.dispatchEvent(app.event('input'));
          app.play().click();
        });
        assert.equal(app.sky().timeRate, 5);
        assert.equal(app.select.value, '5');
        await app.tick(1000);
        assert.equal(app.sky().date.getTime() - start, 5000);
      });
    });
    await t.test('paused 5s → native 10s before change arrives → immediate Play runs at 10×', async t => {
      await withApp(t, fixturePath, async app => {
        await app.pauseAt(5);
        const start = app.sky().date.getTime();
        await app.act(async () => {
          app.select.value = '10';
          app.play().click();
        });
        assert.equal(app.sky().timeRate, 10);
        assert.equal(app.select.value, '10');
        await app.tick(1000);
        assert.equal(app.sky().date.getTime() - start, 10000);
      });
    });
    await t.test('duplicate native input and change do not restart the accelerated clock', async t => {
      await withApp(t, fixturePath, async app => {
        await app.act(async () => {
          app.select.value = '5';
          app.select.dispatchEvent(app.event('input'));
          app.elapse(400);
          app.select.dispatchEvent(app.event('change'));
        });
        assert.equal(app.sky().timeRate, 5);
        await app.tick(600);
        assert.equal(app.sky().date.getTime(), wallStart + 5000);
      });
    });
    for (const seconds of [5, 10]) {
      await t.test(`${seconds}s playback counts by ${seconds} once per real second while the sky updates between ticks`, async t => {
        await withApp(t, fixturePath, async app => {
          await app.pauseAt(seconds);
          const start = app.sky().date.getTime();
          const format = (milliseconds: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(milliseconds));
          await app.act(async () => { app.play().click(); });
          assert.equal(app.readout(), format(start));
          for (let elapsed = 250; elapsed <= 2250; elapsed += 250) {
            await app.tick(250);
            assert.equal(app.sky().date.getTime(), start + elapsed * seconds, `continuous sky at ${elapsed}ms`);
            assert.equal(app.readout(), format(start + Math.floor(elapsed / 1000) * 1000 * seconds), `readout at ${elapsed}ms`);
          }
          await app.act(async () => { app.play().click(); });
          assert.equal(app.sky().timeRate, 0);
          assert.equal(app.readout(), format(start + 2250 * seconds), 'pause reveals the exact simulated moment');
          await app.tick(1000);
          assert.equal(app.readout(), format(start + 2250 * seconds), 'paused readout stays fixed');
        });
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
