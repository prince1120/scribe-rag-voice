/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node harness for the actual owner-call component. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function harness({ slowConnect = false } = {}) {
  const token = deferred(), connection = deferred(), cleanups = [];
  const count = { requests: 0, rooms: 0, capture: 0, stopped: 0, disconnected: 0 };
  const state = [];
  const react = {
    useState(initial) { const index = state.length; state.push(initial); return [initial, value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef: initial => ({ current: initial }), useCallback: callback => callback,
    useEffect(effect) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
  };
  const jsx = (type, props) => ({ type, props });
  const sdk = {
    Room: class {
      constructor() { count.rooms++; }
      on() {} removeAllListeners() {}
      async connect() { if (slowConnect) await connection.promise; }
      async disconnect() { count.disconnected++; }
    },
    RoomEvent: {}, Track: { Kind: { Audio: 'audio' } },
  };
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'livekit-client': sdk,
    '../lib/ownerFetch': { ownerFetch() { count.requests++; return token.promise; } },
    '../lib/apiErrors': { formatClientError: () => 'Call failed', extractApiErrorMessage: async () => 'Call failed' },
    '../components/voice/NetworkBanner': { NetworkBanner: 'banner' },
    '../components/voice/VoiceLatencyTimer': { VoiceLatencyTimer: 'latency-timer' },
    '../components/voice/useCallQuality': { VOICE_ROOM_OPTIONS: {}, useCallQuality: () => ({}) },
    '../components/voice/micEnhancement': {
      async enableEnhancedMic(room, extra, isActive) { if (!isActive || isActive()) count.capture++; },
      stopMicrophone() { count.stopped++; },
    },
    '../components/voice/voiceEvents': { VOICE_DATA_PACKETS: {} },
  };
  function load(file) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, require: name => mocks[name], AbortController,
      navigator: { mediaDevices: { getUserMedia() {} } }, requestAnimationFrame: () => 1,
      cancelAnimationFrame() {}, setInterval, clearInterval, setTimeout, clearTimeout });
    return exports;
  }
  mocks['../components/voice/useCallAttempt'] = load('app/components/voice/useCallAttempt.ts');
  const { AgentVoiceTest } = load('app/agent/AgentVoiceTest.tsx');
  const tree = AgentVoiceTest({ deployed: false });
  function findStart(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props.children === 'Start test call') return node.props.onClick;
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const result = findStart(child); if (result) return result;
    }
    return null;
  }
  const start = findStart(tree);
  assert.equal(typeof start, 'function');
  return { start, count, state, token, connection, close: () => cleanups.forEach(fn => fn()) };
}

test('closing while the token is pending cannot create a room or capture audio', async () => {
  const call = harness();
  const pending = call.start();
  call.close();
  // A server response can still arrive despite client cancellation.
  call.token.resolve(Response.json({ token: 'test', url: 'test' }));
  await pending;
  assert.equal(call.count.rooms, 0);
  assert.equal(call.count.capture, 0);
});

test('repeated startup clicks mint only one token request', async () => {
  const call = harness();
  const first = call.start();
  await call.start();
  assert.equal(call.count.requests, 1);
  call.close();
  call.token.resolve(Response.json({ token: 'test', url: 'test' }));
  await first;
});

test('closing during room connection cannot enable the microphone later', async () => {
  const call = harness({ slowConnect: true });
  const pending = call.start();
  call.token.resolve(Response.json({ token: 'test', url: 'test' }));
  // Wait for JSON parsing/room construction without using a wall-clock delay.
  for (let turn = 0; turn < 100 && call.count.rooms === 0; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(call.count.rooms, 1);
  call.close();
  call.connection.resolve();
  await pending;
  assert.equal(call.count.capture, 0);
  assert.ok(call.count.stopped > 0);
});

test('a live owner test releases capture when its component closes', async () => {
  const call = harness();
  const pending = call.start();
  call.token.resolve(Response.json({ token: 'test', url: 'test' }));
  await pending;
  assert.equal(call.count.capture, 1);
  call.close();
  assert.equal(call.count.stopped, 1);
});

function audioHarness(switchDevice) {
  const states = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef: initial => ({ current: initial }), useCallback: callback => callback, useEffect() {},
  };
  const mocks = { react, 'react/jsx-runtime': {}, 'livekit-client': {}, 'lucide-react': {} };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'app/components/voice/AudioDeviceControls.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] });
  const room = { switchActiveDevice: switchDevice };
  return () => { cursor = 0; return exports.useAudioDevices(room); };
}

test('failed device changes preserve the actual selection and show an error', async () => {
  const render = audioHarness(async () => false);
  await render().selectInput('missing-mic');
  assert.equal(render().activeInputId, 'default');
  assert.match(render().deviceError, /Could not switch microphone/);
  await render().selectOutput('missing-speaker');
  assert.equal(render().activeOutputId, 'default');
  assert.match(render().deviceError, /Could not switch speakers/);
});

test('successful device changes update selection after SDK confirmation', async () => {
  const render = audioHarness(async () => true);
  await render().selectInput('headset-mic');
  await render().selectOutput('headset-speaker');
  assert.equal(render().activeInputId, 'headset-mic');
  assert.equal(render().activeOutputId, 'headset-speaker');
  assert.equal(render().deviceError, '');
});
