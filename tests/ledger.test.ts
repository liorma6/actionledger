import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { actionKey, canonical, fingerprint, Ledger } from '../src/ledger.js';
import { ActionEngine } from '../src/engine.js';
import { sampleAction } from '../src/lab.js';
import type { ActionAdapter } from '../src/engine.js';

const noop = () => {};
const unreachable: ActionAdapter = { dispatch: async () => { throw new Error('unreachable'); }, reconcile: async () => null };
test('canonical identity is order-independent and rejects non-JSON ambiguity', () => {
  assert.equal(canonical({ b: 2, a: [1, true] }), canonical({ a: [1, true], b: 2 }));
  for (const bad of [undefined, NaN, Infinity, new Date(), { missing: undefined }]) assert.throws(() => canonical(bad));
  assert.notEqual(canonical(['a', 'b']), canonical(['b', 'a']));
});
test('a tenant-scoped intent binds every security-relevant input', () => {
  const a = sampleAction(), ledger = new Ledger(':memory:');
  try {
    assert.equal(ledger.claim(a).kind, 'claimed');
    for (const mutation of [{ actor: 'other' }, { account: 'ca_other' }, { version: 'v2' }, { tool: 'chat.send' as const }, { arguments: { start: '18:00' } }, { expectedVersion: 'v1' }]) assert.equal(ledger.claim({ ...a, ...mutation }).kind, 'conflict');
    assert.equal(ledger.claim(a).kind, 'existing');
    assert.equal(ledger.claim({ ...a, tenant: 'other_tenant' }).kind, 'claimed');
    assert.notEqual(fingerprint(a), fingerprint({ ...a, actor: 'other' }));
  } finally { ledger.close(); }
});
test('a committed receipt survives restart without redispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actionledger-')); const file = join(root, 'ledger.db');
  let ledger = new Ledger(file); const a = sampleAction();
  try {
    ledger.claim(a); ledger.transition(actionKey(a), 'COMMITTED', 'provider ack', { id: 'event-2' }); ledger.close(); ledger = new Ledger(file);
    let calls = 0;
    const engine = new ActionEngine(ledger, { ...unreachable, dispatch: async () => { calls++; return null; } }, noop);
    const result = await engine.execute(a); assert.equal(calls, 0); assert.equal(result.state, 'COMMITTED'); assert.deepEqual(result.receipt?.result, { id: 'event-2' }); assert.equal(result.replayed, true);
  } finally { ledger.close(); await rm(root, { recursive: true, force: true }); }
});
for (const state of ['IN_FLIGHT', 'UNKNOWN'] as const) test(`${state} survives a crash/restart and never becomes an automatic retry`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'actionledger-')), file = join(root, 'ledger.db'), a = sampleAction(); let ledger = new Ledger(file);
  try { ledger.claim(a); if (state === 'UNKNOWN') ledger.transition(actionKey(a), state, 'lost reply'); ledger.close(); ledger = new Ledger(file); const result = await new ActionEngine(ledger, unreachable, noop).execute(a); assert.equal(result.state, state); assert.equal(result.replayed, true); }
  finally { ledger.close(); await rm(root, { recursive: true, force: true }); }
});
test('unknown cannot be reset to in-flight and terminal receipts cannot be rewritten', () => {
  const ledger = new Ledger(':memory:'), a = sampleAction();
  try { ledger.claim(a); ledger.transition(actionKey(a), 'UNKNOWN', 'uncertain'); assert.throws(() => ledger.transition(actionKey(a), 'IN_FLIGHT', 'retry')); ledger.transition(actionKey(a), 'COMMITTED', 'evidence', { id: 'x' }); assert.throws(() => ledger.transition(actionKey(a), 'UNKNOWN', 'undo')); } finally { ledger.close(); }
});
test('read failures and missing evidence keep the outcome UNKNOWN and hold subsequent callers', async () => {
  for (const reconcile of [async () => null, async () => { throw new Error('read timeout'); }]) {
    const ledger = new Ledger(':memory:'); let writes = 0;
    try { const engine = new ActionEngine(ledger, { dispatch: async () => { writes++; throw new Error('lost reply'); }, reconcile }, noop); assert.equal((await engine.execute(sampleAction())).state, 'UNKNOWN'); assert.equal((await engine.execute(sampleAction())).state, 'UNKNOWN'); assert.equal(writes, 1); }
    finally { ledger.close(); }
  }
});
test('reconciliation refuses changed inputs even for the same intent', async () => {
  const ledger = new Ledger(':memory:'), a = sampleAction();
  try { ledger.claim(a); ledger.transition(actionKey(a), 'UNKNOWN', 'uncertain'); const engine = new ActionEngine(ledger, unreachable, noop); await assert.rejects(engine.reconcile({ ...a, arguments: { summary: 'other' } }), /conflicting/); assert.equal(ledger.get(actionKey(a))?.state, 'UNKNOWN'); } finally { ledger.close(); }
});
test('two independent database connections cannot both claim an intent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actionledger-')), path = join(root, 'ledger.db'); const a = sampleAction();
  const setup = new Ledger(path); setup.close();
  // Independent worker isolates race the same SQLite transaction and unique key, as separate application workers would.
  const source = `const { parentPort, workerData } = require('node:worker_threads'); require(workerData.register); const { Ledger } = require(workerData.ledgerPath); const ledger = new Ledger(workerData.path); parentPort.once('message', () => { const result = ledger.claim(workerData.action); ledger.close(); parentPort.postMessage(result.kind === 'claimed'); }); parentPort.postMessage('ready');`;
  const require = createRequire(import.meta.url);
  const workers = [0, 1, 2, 3].map(() => new Worker(source, { eval: true, workerData: { path, action: a, register: require.resolve('tsx/cjs'), ledgerPath: fileURLToPath(new URL('../src/ledger.ts', import.meta.url)) } }));
  try {
    await Promise.all(workers.map(w => new Promise<void>((r, reject) => { w.once('message', () => r()); w.once('error', reject); })));
    const claims = workers.map(w => new Promise<boolean>((r, reject) => { w.once('message', r); w.once('error', reject); })); workers.forEach(w => w.postMessage('go'));
    assert.equal((await Promise.all(claims)).filter(Boolean).length, 1);
  } finally { await Promise.all(workers.map(w => w.terminate())); await rm(root, { recursive: true, force: true }); }
});
