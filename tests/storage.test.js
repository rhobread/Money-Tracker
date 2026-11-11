const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateWallet } = require('../src/utils/money');

// Run the storage module against an in-memory AsyncStorage adapter without React Native.
function storage(adapter) {
  const code = fs.readFileSync(require.resolve('../src/storage/walletStorage.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const context = vm.createContext({ AsyncStorage: adapter, validateWallet });
  vm.runInContext(`${code}\nthis.api = { loadWallet, saveWallet };`, context);
  return context.api;
}

test('legacy loading does not write; next successful save stores v3 JSON under the same key', async () => {
  let raw = JSON.stringify({ version: 2, currency: 'IDR', balanceMinor: -29, updatedAt: null });
  let writes = 0;
  const api = storage({
    getItem: async (key) => { assert.equal(key, '@money-tracker/wallet'); return raw; },
    setItem: async (key, value) => { assert.equal(key, '@money-tracker/wallet'); writes++; raw = value; },
  });
  const wallet = await api.loadWallet();
  assert.equal(writes, 0);
  assert.equal(JSON.parse(raw).version, 2);
  await api.saveWallet(wallet);
  assert.equal(writes, 1);
  assert.equal(JSON.parse(raw).sources[0].amountMinor, -29);
  assert.equal(JSON.parse(raw).version, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.loadWallet())), wallet);
});

function hook(loadWallet, saveWallet) {
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  const code = fs.readFileSync(require.resolve('../src/hooks/useWallet.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const context = vm.createContext({
    loadWallet, saveWallet, validateWallet,
    useEffect: () => {},
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next) => { states[index] = next; }];
    },
    useRef: (initial) => {
      const index = refIndex++;
      return refs[index] ?? (refs[index] = { current: initial });
    },
  });
  vm.runInContext(`${code}\nthis.renderHook = useWallet;`, context);
  return () => { stateIndex = 0; refIndex = 0; return context.renderHook(); };
}

test('hook blocks writes before loading and after failed loading', async () => {
  let writes = 0;
  const render = hook(async () => { throw new Error('offline'); }, async () => { writes++; });
  let current = render();
  assert.equal(await current.updateSources([]), false);
  await current.reload();
  current = render();
  assert.ok(current.loadError);
  assert.equal(await current.updateSources([]), false);
  assert.equal(writes, 0);
});

test('hook prevents duplicate writes and changes state only after successful persistence', async () => {
  const wallet = { version: 3, currency: 'IDR', sources: [], updatedAt: null };
  let finish;
  let fail;
  let writes = 0;
  const render = hook(async () => wallet, () => {
    writes++;
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  });
  await render().reload();
  const sources = [{ id: 'a', name: 'Bank', amountMinor: 100000 }];
  let current = render();
  const pending = current.updateSources(sources);
  assert.equal(await current.updateSources(sources), false);
  assert.equal(render().wallet, wallet);
  assert.equal(render().saving, true);
  finish();
  assert.equal(await pending, true);
  current = render();
  assert.equal(current.wallet.sources[0].amountMinor, 100000);
  const saved = current.wallet;
  const failed = current.updateSources([]);
  fail(new Error('disk full'));
  await assert.rejects(failed, /disk full/);
  assert.equal(render().wallet, saved);
  assert.equal(render().saving, false);
  assert.equal(writes, 2);
});

test('failed reads and invalid JSON never write defaults', async () => {
  for (const getItem of [async () => { throw new Error('read failed'); }, async () => '{', async () => '{"version":99}']) {
    let writes = 0;
    const api = storage({ getItem, setItem: async () => { writes++; } });
    await assert.rejects(api.loadWallet());
    assert.equal(writes, 0);
  }
});

test('new storage starts empty; invalid saves and write failures propagate', async () => {
  let writes = 0;
  const api = storage({ getItem: async () => null, setItem: async () => { writes++; throw new Error('disk full'); } });
  const wallet = await api.loadWallet();
  assert.equal(wallet.version, 3);
  assert.equal(wallet.sources.length, 0);
  await assert.rejects(api.saveWallet({ ...wallet, currency: 'USD' }));
  assert.equal(writes, 0);
  await assert.rejects(api.saveWallet(wallet), /disk full/);
  assert.equal(writes, 1);
});
