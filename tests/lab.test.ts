import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runSuite, scenarios, sampleAction } from '../src/lab.js';
import { startTwin } from '../src/twin.js';
import { LocalComposioAdapter } from '../src/adapter.js';
import { RunTelemetry, asOtlp } from '../src/telemetry.js';
import { digest, actionKey, fingerprint } from '../src/ledger.js';
import { startApp } from '../src/server.js';
import type { Report } from '../src/types.js';

let root: string, report: Report;
before(async () => { root = await mkdtemp(join(tmpdir(), 'actionledger-lab-')); report = await runSuite(scenarios.map(s => s.id), root); });
after(async () => { await rm(root, { recursive: true, force: true }); });
for (const scenario of scenarios) test(`real SDK rehearsal: ${scenario.id} preserves every guarded invariant`, () => {
  const r = report.scenarios.find(x => x.scenario.id === scenario.id)!;
  assert.ok(r.guarded.invariants.every(i => i.passed), JSON.stringify(r.guarded.invariants));
  if (scenario.id !== 'normal') assert.ok(r.baseline.invariants.some(i => !i.passed), 'fault must expose a baseline violation');
  else assert.ok(r.baseline.invariants.every(i => i.passed));
});
test('lost response is reconciled with one mutation, one read, then one notification', () => {
  const r = report.scenarios.find(x => x.scenario.id === 'lost-response')!;
  assert.equal(r.guarded.sdkRequests, 3); assert.equal(r.guarded.after.writes, 2); assert.equal(r.baseline.after.writes, 3);
  assert.match(r.guarded.receipts.find(x => x.action.tool === 'calendar.create')!.reason, /matching provider record/);
});
test('unverifiable action is held, not silently counted as completed', () => {
  const r = report.scenarios.find(x => x.scenario.id === 'unverifiable')!;
  assert.equal(r.guarded.sdkRequests, 1); assert.equal(r.guarded.receipts[0].state, 'UNKNOWN'); assert.equal(r.guarded.after.messages.length, 0);
});
test('concurrent dispatch is one actual SDK request, account block is zero', () => {
  assert.equal(report.scenarios.find(x => x.scenario.id === 'concurrent')!.guarded.sdkRequests, 1);
  assert.equal(report.scenarios.find(x => x.scenario.id === 'wrong-account')!.guarded.sdkRequests, 0);
});
test('current published SDK itself does not retry a post-commit disconnect', async () => {
  const twin = await startTwin('disconnect', () => {}), telemetry = new RunTelemetry('test', 'sdk-retries');
  try { const sdk = new LocalComposioAdapter(twin.url, telemetry); await assert.rejects(sdk.dispatch(sampleAction())); assert.equal(twin.requests(), 1); assert.equal(twin.snapshot().writes, 1); } finally { await telemetry.finish(); await twin.close(); }
});
test('reconciliation requires one exact record; zero, duplicate and wrong-account evidence stay unresolved', async () => {
  const a = sampleAction(), match = { id: 'x', marker: actionKey(a), fingerprint: fingerprint(a), account: a.account };
  let items: unknown[] = [];
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 200, data: { items } })); }); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const telemetry = new RunTelemetry('test', 'evidence');
  try {
    const adapter = new LocalComposioAdapter(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, telemetry);
    for (const ambiguous of [[], [match, { ...match, id: 'y' }], [{ ...match, account: 'ca_other' }], [{ ...match, fingerprint: 'wrong' }]]) { items = ambiguous; assert.equal(await adapter.reconcile(a), null); }
    items = [match]; assert.deepEqual(await adapter.reconcile(a), match);
  } finally { await telemetry.finish(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
test('evidence digest is reproducible and real spans have valid parent linkage', () => {
  const { digest: stored, ...content } = JSON.parse(JSON.stringify(report)); assert.equal(digest(content), stored);
  const lane = report.scenarios[0].guarded, rootSpan = lane.spans.find(s => s.name === 'actionledger.rehearsal')!;
  assert.equal(lane.spans.length, lane.sdkRequests + 1);
  for (const span of lane.spans.filter(s => s !== rootSpan)) { assert.equal(span.traceId, rootSpan.traceId); assert.equal(span.parentSpanId, rootSpan.spanId); assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano)); }
  assert.equal(asOtlp(lane.spans).resourceSpans[0].scopeSpans[0].spans.length, lane.spans.length);
  assert.ok(!JSON.stringify(report).includes('actionledger-synthetic-key'));
});
test('pilot adapter refuses remote providers', async () => {
  const telemetry = new RunTelemetry('test', 'scope');
  assert.throws(() => new LocalComposioAdapter('https://backend.composio.dev', telemetry), /loopback/); await telemetry.finish();
});
test('API rejects arbitrary input, cross-origin writes and DNS-rebinding hosts', async () => {
  const app = await startApp(0, join(root, 'api')); const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    for (const body of [{ scenarios: ['unknown'] }, { scenarios: ['normal', 'normal'] }, { scenarios: ['normal'], endpoint: 'https://evil.example' }, { scenarios: [] }]) assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
    assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ scenarios: ['normal'] }) })).status, 403);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => { get(base + '/api/scenarios', { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(base + '/api/runs', { method: 'POST', body: '{}' })).status, 415);
  } finally { await app.close(); }
});
test('a completed report survives an actual app server and database restart', async () => {
  const data = join(root, 'restart-api'); let app = await startApp(0, data);
  const url = () => `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const created = await (await fetch(url() + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarios: ['normal'] }) })).json() as { id: string };
    const deadline = Date.now() + 10_000; let completed: { status: string; report?: Report } = { status: 'running' };
    while (completed.status === 'running' && Date.now() < deadline) { await new Promise(r => setTimeout(r, 20)); completed = await (await fetch(url() + '/api/runs/' + created.id)).json() as typeof completed; }
    assert.equal(completed.status, 'complete'); const expectedDigest = completed.report!.digest;
    await app.close(); app = await startApp(0, data);
    const restored = await (await fetch(url() + '/api/runs/' + created.id)).json() as { report: Report };
    assert.equal(restored.report.digest, expectedDigest); assert.equal(restored.report.scenarios[0].guarded.after.messages.length, 1);
  } finally { await app.close(); }
});
