import { actionKey, fingerprint, Ledger } from './ledger.js';
import { DefiniteRejection } from './adapter.js';
import type { Action, Json, Outcome } from './types.js';
import type { Log } from './twin.js';

export interface ActionAdapter { dispatch(action: Action): Promise<Json>; reconcile(action: Action): Promise<Json | null> }
export class ActionEngine {
  constructor(private ledger: Ledger, private adapter: ActionAdapter, private log: Log, private allowedAccounts: ReadonlySet<string> = new Set(['ca_demo'])) {}
  async execute(action: Action, verify = true): Promise<Outcome> {
    if (!this.allowedAccounts.has(action.account)) { this.log('decision', 'Account blocked', 'Requested account is outside the trusted local policy.', 'good'); return { state: 'BLOCKED', reason: 'Account is not authorized for this actor in the fixture policy', replayed: false }; }
    const claim = this.ledger.claim(action);
    if (claim.kind === 'conflict') { this.log('decision', 'Intent conflict blocked', 'The same intent was reused with a different actor, account, tool, version or payload.', 'good'); return { state: 'KEY_CONFLICT', reason: 'Intent is already bound to different inputs', replayed: false, receipt: claim.receipt }; }
    if (claim.kind === 'existing') {
      this.log('ledger', 'Existing receipt returned', `${claim.receipt.state} · no second dispatch`, 'good');
      return { state: claim.receipt.state, reason: claim.receipt.reason, replayed: true, receipt: claim.receipt };
    }
    this.log('ledger', 'Intent durably claimed', 'SQLite committed IN_FLIGHT before the SDK call.', 'info', { key: claim.receipt.key, fingerprint: claim.receipt.fingerprint });
    try {
      const result = await this.adapter.dispatch(action);
      const receipt = this.ledger.transition(actionKey(action), 'COMMITTED', 'Provider acknowledged a durable resource', result);
      this.log('ledger', 'Receipt committed', 'The result is stored for repeat callers.', 'good');
      return { state: receipt.state, reason: receipt.reason, replayed: false, receipt };
    } catch (error) {
      const definite = error instanceof DefiniteRejection;
      const receipt = this.ledger.transition(actionKey(action), definite ? 'REJECTED' : 'UNKNOWN', definite ? error.message : 'Outcome uncertain; repeating the mutation is unsafe');
      this.log('ledger', definite ? 'Update rejected safely' : 'Outcome marked UNKNOWN', receipt.reason, 'warn');
      if (!definite && verify) return this.reconcile(action);
      return { state: receipt.state, reason: receipt.reason, replayed: false, receipt };
    }
  }
  async reconcile(action: Action): Promise<Outcome> {
    const receipt = this.ledger.get(actionKey(action));
    if (!receipt || receipt.fingerprint !== fingerprint(action)) throw new Error('Cannot reconcile an unknown or conflicting intent');
    if (receipt.state !== 'UNKNOWN') return { state: receipt.state, reason: receipt.reason, replayed: true, receipt };
    let evidence: Json | null = null;
    try { evidence = await this.adapter.reconcile(action); } catch { /* A failed read leaves the action uncertain. */ }
    if (evidence !== null) {
      const updated = this.ledger.transition(receipt.key, 'COMMITTED', 'One matching provider record verified by intent, fingerprint and account', evidence);
      this.log('decision', 'Reconciled from provider evidence', 'Exactly one matching durable record. No mutation retry.', 'good', { key: receipt.key });
      return { state: updated.state, reason: updated.reason, replayed: false, receipt: updated };
    }
    this.log('decision', 'Held for review', 'No unique authoritative evidence. Zero matches would not prove failure.', 'warn');
    return { state: 'UNKNOWN', reason: receipt.reason, replayed: false, receipt };
  }
}
