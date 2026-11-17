# Validation record

Local validation: **17 November 2026**, Windows, Node.js 24.11.0, published `@composio/core` 0.29.0. CI separately repeats verification on Ubuntu / Node 24. The badge and workflow run provide current remote status.

| Check | Observed local result |
| --- | --- |
| Strict TypeScript checking | Passed |
| Backend, ledger, SDK and API tests | **26 passed** |
| Playwright desktop/mobile application flows | **16 passed** |
| Playwright desktop/mobile recorded-demo flows | **4 passed** |
| Production frontend/backend build | Passed |
| npm installation audit | 0 known vulnerabilities reported during installation |

**46 tests in total.** Browser tests use Chromium on a desktop viewport and Pixel 7 emulation. This is not real-device, Safari, Firefox, accessibility-conformance or load testing.

The first browser attempt started before the new Chromium installation finished and encountered Windows launch `EBUSY` errors. After installation completed, all 16 application flows passed. No application assertion was disabled or skipped. An earlier HTTP host-header test used Fetch, which did not transmit the test's Host override; it was corrected to use Node HTTP and verified the server's rejection.

## Evidence the tests inspect

- One actual SDK call after a provider commits and disconnects; the current SDK itself does not retry.
- Exact provider-state changes, notification counts, protected human edit and input/account conflicts across eight paired fault/control cases.
- UNKNOWN and IN_FLIGHT records surviving a database close/reopen without redispatch; COMMITTED receipts returning their stored result.
- Four independent worker isolates executing the **production Ledger class** against one SQLite file; exactly one claims the intent.
- Zero, multiple, mismatched-account and mismatched-fingerprint reconciliation results remain unresolved.
- A completed API report survives an actual server/database restart.
- JSON/body restrictions, same-origin write checks and hostile Host rejection.
- Real OpenTelemetry trace IDs, parent relationships, timestamps, export shape and reproducible report digest.
- Browser scenario selection, error recovery, history restoration, state comparison, receipt expansion, event inspection and report/trace downloads.
- The public preview clearly labels recorded evidence and emits no execution POST requests.

## Results of the synthetic rehearsal

| Measurement | Unsafe application policy | ActionLedger |
| --- | --- | --- |
| Scenarios | 8 | 8 |
| Invariant violations | 9 | 0 |
| Provider mutations, including notifications | 24 | 9 |
| Guarded committed receipts | N/A | 8 |
| Guarded UNKNOWN receipts held | N/A | 1 |

Several checks can describe the same incident. Lower write counts include blocked and unresolved actions. These measurements are **not** a production success percentage, performance comparison, or estimate of money saved. Runtime is recorded for reproducibility, not benchmarked.

The evidence files contain synthetic identities and payloads. See [rehearsal.json](evidence/rehearsal.json) and [traces.otlp.json](evidence/traces.otlp.json). Runtime databases are excluded from Git. Screenshots show the actual local UI.

## Remaining validation

No hosted Composio, OAuth flow, live calendar/chat API, LLM, customer workload, cross-region failure or storage-corruption test was performed. The account policy and provider correlation contract are fixtures. Crash recovery deliberately holds pending work; no automatic lease reclamation or manual resolution UI is implemented. The public demo has no write-capable backend.
