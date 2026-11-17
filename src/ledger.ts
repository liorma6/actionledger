import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Action, ActionState, Json, Receipt } from './types.js';

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('Only finite JSON values are supported');
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const actionKey = (a: Action) => digest([a.tenant, a.intent]);
export const fingerprint = (a: Action) => digest({ ...a, expectedVersion: a.expectedVersion ?? null });

type Row = { key: string; fingerprint: string; state: ActionState; action_json: string; result_json: string; reason: string; created_at: string; updated_at: string };
function receipt(row: Row): Receipt {
  return { key: row.key, fingerprint: row.fingerprint, state: row.state, action: JSON.parse(row.action_json), result: JSON.parse(row.result_json), reason: row.reason, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** One tenant-scoped intent binds actor, account, tool, version and exact canonical inputs. */
export class Ledger {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS actions (
        key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL,
        action_json TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT 'null', reason TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action_key TEXT NOT NULL REFERENCES actions(key),
        state TEXT NOT NULL, reason TEXT NOT NULL, timestamp TEXT NOT NULL
      );`);
  }
  get(key: string): Receipt | undefined {
    const row = this.db.prepare('SELECT * FROM actions WHERE key = ?').get(key) as Row | undefined;
    return row && receipt(row);
  }
  list(): Receipt[] {
    return (this.db.prepare('SELECT * FROM actions ORDER BY created_at, key').all() as Row[]).map(receipt);
  }
  claim(action: Action): { kind: 'claimed' | 'existing' | 'conflict'; receipt: Receipt } {
    const key = actionKey(action), hash = fingerprint(action), now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(key);
      if (current) {
        this.db.exec('COMMIT');
        return { kind: current.fingerprint === hash ? 'existing' : 'conflict', receipt: current };
      }
      this.db.prepare("INSERT INTO actions(key,fingerprint,state,action_json,reason,created_at,updated_at) VALUES (?,?,'IN_FLIGHT',?,'Intent claimed before dispatch',?,?)")
        .run(key, hash, JSON.stringify(action), now, now);
      this.db.prepare("INSERT INTO transitions(action_key,state,reason,timestamp) VALUES (?,'IN_FLIGHT','Intent claimed before dispatch',?)").run(key, now);
      this.db.exec('COMMIT');
      return { kind: 'claimed', receipt: this.get(key)! };
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  transition(key: string, state: ActionState, reason: string, result: Json = null): Receipt {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(key);
      if (!current) throw new Error('Unknown action');
      const allowed: Record<ActionState, ActionState[]> = { IN_FLIGHT: ['COMMITTED', 'UNKNOWN', 'REJECTED'], UNKNOWN: ['COMMITTED'], COMMITTED: [], REJECTED: [] };
      if (!allowed[current.state].includes(state)) throw new Error(`Invalid transition ${current.state} -> ${state}`);
      const now = new Date().toISOString();
      this.db.prepare('UPDATE actions SET state=?,reason=?,result_json=?,updated_at=? WHERE key=?').run(state, reason, JSON.stringify(result), now, key);
      this.db.prepare('INSERT INTO transitions(action_key,state,reason,timestamp) VALUES (?,?,?,?)').run(key, state, reason, now);
      this.db.exec('COMMIT');
      return this.get(key)!;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
