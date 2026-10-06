/* eslint-disable @typescript-eslint/no-require-imports -- Test actual segment merging. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/components/voice/mergeTranscript.ts'), 'utf8');
const output = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: output });
const { mergeTranscript } = output;
const segment = (id, text, role = 'user') => ({ id, text, role, final: true });

test('separate ASR segments retain all words in one user bubble and replace interim text', () => {
  let lines = mergeTranscript([], segment('one', 'I want to know'));
  lines = mergeTranscript(lines, segment('two', 'do you'));
  lines = mergeTranscript(lines, segment('three', 'offer support'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'I want to know do you offer support');
  lines = mergeTranscript(lines, segment('three', 'offer support?'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'I want to know do you offer support?');
});

test('an assistant reply separates user turns and late segment updates stay in their original turn', () => {
  let lines = mergeTranscript([], segment('one', 'First'));
  lines = mergeTranscript(lines, segment('reply', 'Answer', 'assistant'));
  lines = mergeTranscript(lines, segment('two', 'Next question'));
  lines = mergeTranscript(lines, segment('one', 'First question'));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, 'First question');
  assert.equal(lines[2].text, 'Next question');
});
