/* eslint-disable @typescript-eslint/no-require-imports -- Test the actual timer with synthetic monotonic timestamps. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/components/voice/latencyTimer.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject });
const { LatencyTimer } = exportsObject;

test('counts from last voiced sample, freezes on reply audio, resets on next speech', () => {
  const timer = new LatencyTimer();
  assert.equal(timer.sample(0, false, true).phase, 'idle'); // Greeting is not a reply.
  timer.sample(100, true, false);
  assert.equal(timer.sample(200, true, false).phase, 'speaking');
  timer.sample(300, true, false);
  assert.equal(timer.sample(400, false, false).phase, 'speaking');
  assert.equal(timer.sample(460, false, false).ms, 160);
  const reply = timer.sample(900, false, true);
  assert.equal(reply.phase, 'done');
  assert.equal(reply.ms, 600);
  assert.equal(timer.sample(1200, false, false).ms, 600);
  timer.sample(1300, true, true);
  assert.equal(timer.sample(1400, true, true).ms, 0);
  assert.equal(timer.sample(1400, true, true).phase, 'speaking');
  assert.equal(timer.sample(1600, false, false).phase, 'waiting');
});

test('short noise and brief speech pauses do not create a turn', () => {
  const timer = new LatencyTimer();
  timer.sample(10, true, false);
  assert.equal(timer.sample(50, false, false).phase, 'idle');
  timer.sample(100, true, false);
  timer.sample(200, true, false);
  assert.equal(timer.sample(300, false, false).phase, 'speaking');
  timer.sample(320, true, false);
  timer.sample(420, true, false);
  assert.equal(timer.sample(600, false, true).ms, 180);
});

test('records fast audio arriving during the silence confirmation window', () => {
  const timer = new LatencyTimer();
  timer.sample(0, true, false);
  timer.sample(100, true, false);
  timer.sample(140, false, true);
  const reply = timer.sample(260, false, false);
  assert.equal(reply.phase, 'done');
  assert.equal(reply.ms, 40);
});
