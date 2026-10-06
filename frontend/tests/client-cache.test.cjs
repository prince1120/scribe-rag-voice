// Run: node --test tests/client-cache.test.cjs
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node harness for isolated TypeScript modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(file, mocks, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => mocks[name],
    window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Headers, Response, Date, ...globals });
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function workspaceHarness() {
  const requests = [];
  const cache = loadModule('app/lib/workspaceCache.ts', {
    react: {}, './ownerFetch': {
      clearOwnerRequests() {},
      ownerFetch(url) { const result = deferred(); requests.push({ url, ...result }); return result.promise; },
    },
  });
  const respond = (offset, name, status = 'draft') => {
    requests[offset].resolve(Response.json({ business_name: name, email: `${name}@example.test` }));
    requests[offset + 1].resolve(Response.json({ status }));
  };
  return { cache, requests, respond };
}

test('simultaneous workspace consumers share one revalidation', async () => {
  const { cache, requests, respond } = workspaceHarness();
  const first = cache.revalidateWorkspace();
  const second = cache.revalidateWorkspace();
  assert.equal(first, second);
  assert.equal(requests.length, 2);
  respond(0, 'first');
  await first;
  assert.equal(cache.getWorkspaceCache().businessName, 'first');
});

test('old responses cannot repopulate the workspace after sign-out', async () => {
  const { cache, respond } = workspaceHarness();
  const first = cache.revalidateWorkspace();
  cache.clearWorkspaceCache();
  respond(0, 'previous-owner', 'deployed');
  await first;
  assert.equal(cache.getWorkspaceCache().businessName, null);
  assert.equal(cache.getWorkspaceCache().loaded, false);
});

test('local agent edits supersede earlier background responses', async () => {
  const { cache, respond } = workspaceHarness();
  const first = cache.revalidateWorkspace();
  cache.setWorkspaceCache({ status: 'deployed', agentConfig: { name: 'new-agent' } });
  respond(0, 'old', 'draft');
  await first;
  assert.equal(cache.getWorkspaceCache().status, 'deployed');
  assert.equal(cache.getWorkspaceCache().agentConfig.name, 'new-agent');
});

test('forced refresh supersedes an older request after agent switching', async () => {
  const { cache, respond } = workspaceHarness();
  const old = cache.revalidateWorkspace();
  const fresh = cache.revalidateWorkspace(true);
  respond(2, 'new', 'deployed');
  await fresh;
  respond(0, 'old', 'draft');
  await old;
  assert.equal(cache.getWorkspaceCache().businessName, 'new');
  assert.equal(cache.getWorkspaceCache().status, 'deployed');
});

test('401 from agent configuration clears cached owner data', async () => {
  const { cache, requests } = workspaceHarness();
  cache.setWorkspaceCache({ businessName: 'old', loaded: true });
  const pending = cache.revalidateWorkspace(true);
  requests[0].resolve(Response.json({ business_name: 'old' }));
  requests[1].resolve(new Response(null, { status: 401 }));
  await pending;
  assert.equal(cache.getWorkspaceCache().loaded, false);
});

test('owner response cache is invalidated when a credential changes', async () => {
  const stored = new Map([['demo_groq_key', 'test-identity-a']]);
  let reads = 0;
  const { ownerFetch } = loadModule('app/lib/ownerFetch.ts', {}, {
    localStorage: { getItem: key => stored.get(key) || null },
    fetch: async () => Response.json({ read: ++reads }),
  });
  assert.equal((await (await ownerFetch('/api/v1/contacts')).json()).read, 1);
  assert.equal((await (await ownerFetch('/api/v1/contacts')).json()).read, 1);
  stored.set('demo_groq_key', 'test-identity-b');
  assert.equal((await (await ownerFetch('/api/v1/contacts')).json()).read, 2);
});

function documentHarness() {
  const states = [], refs = [], requests = new Map();
  let stateIndex = 0, refIndex = 0;
  const { useDocuments } = loadModule('app/hooks/useDocuments.ts', {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useCallback: callback => callback, useEffect() {},
    },
    '../lib/api': { ApiError: Error, documents: {
      content(id) { const request = deferred(); requests.set(id, request); return request.promise; },
      saveContent() { const request = deferred(); requests.set('save', request); return request.promise; },
    } },
    '../Toast': {},
  });
  const render = () => {
    stateIndex = 0; refIndex = 0;
    return useDocuments({ creds: {}, sessionId: 'test', enabled: true, notify() {} });
  };
  const content = text => ({ filename: text, content: text, editable: true, is_image: false });
  return { render, requests, content };
}

test('a slower document response cannot overwrite the newly opened document', async () => {
  const { render, requests, content } = documentHarness();
  const hook = render();
  const first = hook.openDocument('first');
  const second = hook.openDocument('second');
  requests.get('second').resolve(content('second'));
  await second;
  requests.get('first').resolve(content('first'));
  await first;
  assert.equal(render().docEditor.documentId, 'second');
  assert.equal(render().docEditor.content, 'second');
});

test('a late document response does not reopen a closed editor', async () => {
  const { render, requests, content } = documentHarness();
  const hook = render();
  const pending = hook.openDocument('first');
  hook.setDocEditor(null);
  requests.get('first').resolve(content('first'));
  await pending;
  assert.equal(render().docEditor, null);
});

test('edits made during save remain unsaved until their own save succeeds', async () => {
  const { render, requests, content } = documentHarness();
  const pending = render().openDocument('first');
  requests.get('first').resolve(content('original'));
  await pending;
  render().setDocEditor(prev => ({ ...prev, content: 'submitted' }));
  const saving = render().saveDocumentEditor();
  render().setDocEditor(prev => ({ ...prev, content: 'newer-edit' }));
  requests.get('save').resolve({ chunk_count: 2 });
  await saving;
  assert.equal(render().docEditor.content, 'newer-edit');
  assert.equal(render().docEditor.originalContent, 'submitted');
});
