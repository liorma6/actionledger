import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Ledger, digest } from './ledger.js';
import { startTwin, type Log } from './twin.js';
import { LocalComposioAdapter } from './adapter.js';
import { ActionEngine } from './engine.js';
import { RunTelemetry } from './telemetry.js';
import type { Action, Invariant, LaneResult, Outcome, Report, Scenario, ScenarioResult, TimelineEvent } from './types.js';

export const scenarios: Scenario[] = [
  { id: 'lost-response', name: 'The response disappeared', short: 'Commit → connection lost → retry?', description: 'The provider stores an event, then the TCP connection closes before the SDK receives a response. The unsafe caller retries; the guarded caller checks durable evidence.', category: 'Recovery', fault: 'disconnect', verification: true },
  { id: 'unverifiable', name: 'No evidence to trust', short: 'Unknown must stay unknown', description: 'The same connection loss, with no reconciliation capability. ActionLedger holds the action and its dependent notification. Safety is preserved; the task is not completed.', category: 'Recovery', fault: 'disconnect', verification: false },
  { id: 'stale-write', name: 'A human changed the plan', short: 'Protect an intervening edit', description: 'An agent reads v1. A human writes v2. An unconditional update overwrites the human; a conditional update using If-Match is rejected with 412.', category: 'Concurrency', fault: 'stale', verification: false },
  { id: 'concurrent', name: 'Eight callers, one intent', short: 'Race for the same action', description: 'Eight concurrent invocations share an intent. An atomic SQLite claim grants only one writer. Other callers receive a pending or committed receipt.', category: 'Concurrency', fault: 'none', verification: true },
  { id: 'key-conflict', name: 'Same key, changed payload', short: 'Bind the complete decision', description: 'A caller reuses an existing intent with a different meeting title. The full fingerprint detects the conflict instead of treating the changed action as a fresh request.', category: 'Identity', fault: 'none', verification: true },
  { id: 'wrong-account', name: 'The wrong connected account', short: 'Check scope before dispatch', description: 'A scripted caller selects ca_other. The fixture policy authorizes ca_demo only. ActionLedger blocks before any SDK call. This is a local policy fixture, not production IAM.', category: 'Identity', fault: 'none', verification: true },
  { id: 'false-failure', name: 'Failure did not mean failure', short: 'A 500 after a successful write', description: 'The synthetic proxy returns a failure after storing the event. The outcome is resolved from a unique provider record, rather than interpreting an error as permission to retry.', category: 'Recovery', fault: 'false-failure', verification: true },
  { id: 'normal', name: 'The healthy path', short: 'A control that actually completes', description: 'No fault is injected. Both paths should create one event and one notification. A safety layer must also allow normal work to complete.', category: 'Control', fault: 'none', verification: true },
];

export const sampleAction = (): Action => ({ tenant: 'workspace_demo', actor: 'agent_scheduler', intent: 'schedule-launch-001', account: 'ca_demo', tool: 'calendar.create', version: 'fixture-calendar-v1', arguments: { summary: 'Launch planning', start: '14:00' } });

async function lane(scenario: Scenario, guarded: boolean, directory: string): Promise<LaneResult> {
  const timeline: TimelineEvent[] = [];
  const log: Log = (kind, title, detail, level = 'info', data) => timeline.push({ sequence: timeline.length + 1, kind, title, detail, level, ...(data ? { data } : {}) });
  const twin = await startTwin(scenario.fault, log);
  const telemetry = new RunTelemetry(guarded ? 'guarded' : 'caller-retry', scenario.id);
  const adapter = new LocalComposioAdapter(twin.url, telemetry);
  const ledger = new Ledger(join(directory, `${scenario.id}-${guarded ? 'guarded' : 'baseline'}.sqlite`));
  const engine = new ActionEngine(ledger, adapter, log);
  const before = twin.snapshot();
  const outcomes: Outcome[] = [];
  const perform = async (action: Action): Promise<Outcome> => {
    let outcome: Outcome;
    if (guarded) outcome = await engine.execute(action, scenario.verification);
    else {
      // Intentionally unsafe APPLICATION policy. The current SDK itself does NOT retry tool execution.
      try { await adapter.dispatch(action, false); outcome = { state: 'COMMITTED', reason: 'Caller received success', replayed: false }; }
      catch {
        log('decision', 'Application retries the write', 'Deliberately unsafe comparison policy; this is not SDK automatic retry behavior.', 'bad');
        try { await adapter.dispatch(action, false); outcome = { state: 'COMMITTED', reason: 'Caller received success after retry', replayed: false }; }
        catch { outcome = { state: 'UNKNOWN', reason: 'Both caller attempts failed', replayed: false }; }
      }
    }
    outcomes.push(outcome); return outcome;
  };
  try {
    let action = sampleAction();
    if (scenario.id === 'wrong-account') action = { ...action, account: 'ca_other' };
    if (scenario.id === 'stale-write') {
      action = { ...action, tool: 'calendar.patch', arguments: { id: 'event-planning', summary: 'Agent rescheduled planning', start: '14:00' }, expectedVersion: 'v1' };
      const observed = await adapter.readEvent(action) as { etag: string };
      action.expectedVersion = observed.etag; twin.externalEdit();
    }
    let primary: Outcome;
    if (scenario.id === 'concurrent') { const results = await Promise.all(Array.from({ length: 8 }, () => perform(action))); primary = results.find(r => r.state === 'COMMITTED') ?? results[0]; }
    else {
      primary = await perform(action);
      if (scenario.id === 'key-conflict') await perform({ ...action, arguments: { ...action.arguments, summary: 'Changed intent, same key' } });
    }
    if (['lost-response', 'unverifiable', 'false-failure', 'normal', 'stale-write'].includes(scenario.id)) {
      if (primary.state === 'COMMITTED') await perform({ ...sampleAction(), intent: action.intent + '/notify', tool: 'chat.send', version: 'fixture-chat-v1', arguments: { text: 'Meeting action confirmed.' } });
      else log('decision', 'Dependent notification held', 'An uncertain or rejected meeting action cannot release the notification.', 'warn');
    }
    const after = twin.snapshot();
    const created = after.events.filter(e => e.id !== 'event-planning');
    const invariants: Invariant[] = [];
    const check = (id: string, label: string, passed: boolean, observed: string) => invariants.push({ id, label, passed, observed });
    check('one-effect', 'One intent produces at most one meeting', created.length <= 1, `${created.length} new meeting(s)`);
    check('account', 'No writes to an unauthorized account', !after.events.some(e => e.account !== 'ca_demo') && !after.messages.some(e => e.account !== 'ca_demo'), `${after.events.filter(e => e.account !== 'ca_demo').length} foreign-account event(s)`);
    if (scenario.id === 'stale-write') check('human-edit', 'The newer human edit survives', after.events[0].start === '11:00', `Current start ${after.events[0].start}; human chose 11:00`);
    if (scenario.id === 'key-conflict') check('binding', 'Changed inputs cannot reuse the intent', !created.some(e => e.summary === 'Changed intent, same key'), `${created.filter(e => e.summary === 'Changed intent, same key').length} conflicting effect(s)`);
    if (scenario.id === 'unverifiable') check('held', 'No notification without a verified unique outcome', after.messages.length === 0, `${after.messages.length} notification(s); ${primary.state}`);
    if (scenario.id === 'normal') check('complete', 'Healthy work completes with its notification', created.length === 1 && after.messages.length === 1, `${created.length} event + ${after.messages.length} notification`);
    const spans = await telemetry.finish();
    return { mode: guarded ? 'guarded' : 'caller-retry', before, after, outcomes: outcomes.map(o => ({ state: o.state, reason: o.reason })), receipts: ledger.list(), timeline, invariants, sdkRequests: twin.requests(), spans };
  } finally { ledger.close(); await twin.close(); }
}

export async function runSuite(ids: string[], root: string, progress: (completed: number, scenario: string) => void = () => {}, runId = randomUUID()): Promise<Report> {
  if (!ids.length || ids.length > scenarios.length || new Set(ids).size !== ids.length || ids.some(id => !scenarios.some(s => s.id === id))) throw new Error('Select one to eight unique known scenarios');
  const started = Date.now(), directory = join(root, runId); await mkdir(directory, { recursive: true });
  const results: ScenarioResult[] = [];
  for (const id of ids) {
    const scenario = scenarios.find(s => s.id === id)!;
    const baseline = await lane(scenario, false, directory), guarded = await lane(scenario, true, directory);
    results.push({ scenario, baseline, guarded }); progress(results.length, scenario.name);
  }
  const summary = {
    scenarios: results.length,
    baselineViolations: results.reduce((n, r) => n + r.baseline.invariants.filter(i => !i.passed).length, 0),
    guardedViolations: results.reduce((n, r) => n + r.guarded.invariants.filter(i => !i.passed).length, 0),
    baselineWrites: results.reduce((n, r) => n + r.baseline.after.writes, 0), guardedWrites: results.reduce((n, r) => n + r.guarded.after.writes, 0),
    committed: results.flatMap(r => r.guarded.receipts).filter(r => r.state === 'COMMITTED').length,
    held: results.flatMap(r => r.guarded.receipts).filter(r => ['UNKNOWN', 'IN_FLIGHT'].includes(r.state)).length,
  };
  const content = { id: runId, createdAt: new Date().toISOString(), durationMs: Date.now() - started, source: 'Published @composio/core 0.29.0 → local protocol twin. Synthetic data. Scripted callers; no live provider or LLM.', scenarios: results, summary };
  // JSON normalization removes optional undefined span fields before canonical hashing.
  return { ...content, digest: digest(JSON.parse(JSON.stringify(content))) };
}
