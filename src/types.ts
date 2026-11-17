export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ActionState = 'IN_FLIGHT' | 'COMMITTED' | 'UNKNOWN' | 'REJECTED';
export type OutcomeState = ActionState | 'BLOCKED' | 'KEY_CONFLICT';

export interface Action {
  tenant: string;
  actor: string;
  intent: string;
  account: string;
  tool: 'calendar.create' | 'calendar.patch' | 'chat.send';
  version: string;
  arguments: Record<string, Json>;
  expectedVersion?: string;
}

export interface Receipt {
  key: string;
  fingerprint: string;
  state: ActionState;
  action: Action;
  result: Json;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface Outcome {
  state: OutcomeState;
  reason: string;
  replayed: boolean;
  receipt?: Receipt;
}

export interface TimelineEvent {
  sequence: number;
  kind: 'ledger' | 'request' | 'provider' | 'decision';
  title: string;
  detail: string;
  level: 'info' | 'good' | 'warn' | 'bad';
  data?: Record<string, Json>;
}

export interface WorldEvent { id: string; summary: string; start: string; etag: string; account: string; marker?: string; fingerprint?: string; }
export interface WorldMessage { id: string; text: string; account: string; marker?: string; fingerprint?: string; }
export interface World { events: WorldEvent[]; messages: WorldMessage[]; writes: number; }
export interface Invariant { id: string; label: string; passed: boolean; observed: string; }
export interface TraceSpan { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano: string; endTimeUnixNano: string; attributes: Record<string, Json>; status: number; }

export interface LaneResult {
  mode: 'caller-retry' | 'guarded';
  before: World;
  after: World;
  outcomes: { state: string; reason: string }[];
  receipts: Receipt[];
  timeline: TimelineEvent[];
  invariants: Invariant[];
  sdkRequests: number;
  spans: TraceSpan[];
}

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  category: 'Recovery' | 'Concurrency' | 'Identity' | 'Control';
  fault: 'disconnect' | 'false-failure' | 'stale' | 'none';
  verification: boolean;
}
export interface ScenarioResult { scenario: Scenario; baseline: LaneResult; guarded: LaneResult; }
export interface Report {
  id: string;
  createdAt: string;
  durationMs: number;
  source: string;
  scenarios: ScenarioResult[];
  summary: { scenarios: number; baselineViolations: number; guardedViolations: number; baselineWrites: number; guardedWrites: number; committed: number; held: number };
  digest: string;
}
