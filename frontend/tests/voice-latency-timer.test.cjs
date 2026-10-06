/* eslint-disable @typescript-eslint/no-require-imports -- Run the actual timer with synthetic timestamps. */
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

test('only VAD starts/reset speech, VAD silence counts, first reply freezes', () => {
  const timer = new LatencyTimer();
  assert.equal(timer.sample(100, true).phase, 'idle'); // Greeting does not start a turn.
  assert.equal(timer.speech(200, true).ms, 0);
  assert.equal(timer.sample(400, false).phase, 'speaking');
  assert.equal(timer.speech(640, false, 240).ms, 240);
  assert.equal(timer.sample(900, false).ms, 500);
  assert.equal(timer.sample(1000, true).ms, 600);
  assert.equal(timer.sample(2000, true).ms, 600);
  assert.equal(timer.sample(2500, false).ms, 600);
  assert.equal(timer.speech(2600, true).ms, 0);
});

test('playback and its gaps cannot reset or restart a finished turn', () => {
  const timer = new LatencyTimer();
  timer.speech(0, true);
  timer.speech(200, false);
  assert.equal(timer.sample(500, true).ms, 300);
  for (const [now, audible] of [[600, false], [700, true], [800, false], [900, true]]) {
    assert.equal(timer.sample(now, audible).phase, 'done');
    assert.equal(timer.sample(now, audible).ms, 300);
  }
});

test('confirmed barge-in resets even while the assistant is audible', () => {
  const timer = new LatencyTimer();
  timer.speech(0, true);
  timer.speech(200, false);
  timer.sample(500, true);
  timer.speech(600, true);
  assert.equal(timer.sample(640, true).phase, 'speaking');
  assert.equal(timer.sample(640, true).ms, 0);
  timer.speech(1000, false);
  assert.equal(timer.sample(1200, false).ms, 200);
});

test('duplicate silence events do not start a timer', () => {
  const timer = new LatencyTimer();
  assert.equal(timer.speech(0, false).phase, 'idle');
  timer.speech(100, true);
  timer.speech(200, false);
  timer.speech(400, false);
  assert.equal(timer.sample(500, true).ms, 300);
});
