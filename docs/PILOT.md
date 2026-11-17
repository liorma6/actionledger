# Design-partner pilot: recover agent actions with evidence

**For:** the Composio SDK/platform engineering owner and a design partner operating write-capable agents.

**Prepared by:** Lior Mashiach · [GitHub](https://github.com/liorma6) · [LinkedIn](https://www.linkedin.com/in/lior-mashiach/)

## The concrete problem

A calendar create succeeds, but its response is lost. The SDK correctly avoids an automatic retry. The agent or application still has a decision to make: repeat, stop or verify. Repeating may create a duplicate; blindly continuing may send an inaccurate notification.

The attached independent prototype supplies an inspectable decision record around that boundary. It combines the Composio TypeScript SDK, SQLite receipts, OpenTelemetry and a React interface. It acknowledges the existing retry mitigation and the ongoing work in [#3654](https://github.com/ComposioHQ/composio/issues/3654).

## Available to review today

- [Interactive recorded evidence](https://liorma6.github.io/actionledger/) without installing anything.
- [Runnable source and setup](https://github.com/liorma6/actionledger).
- Eight paired scenarios with actual local provider mutations, invariant checks and trace exports.
- Tests for restart persistence, concurrent SQLite claims, ambiguous read-back, input binding and desktop/mobile interactions.

The public demo displays a recorded local rehearsal. The runnable pilot invokes the published SDK against a small local protocol twin, **not hosted Composio or a live calendar/chat provider**. It uses no real customer records or credentials.

## Proposed next step

A short technical review, then a tightly scoped, separately agreed design-partner experiment:

| Stage | Deliverable | Acceptance condition |
| --- | --- | --- |
| Contract review | One real create/update workflow, supported identity fields and provider evidence model | An engineering owner agrees which evidence is authoritative and which cases must stay held |
| Disposable environment | One provider integration through hosted Composio, with explicit test-account authorization | Synthetic-only fixtures, bounded permissions, cleanup procedure and no customer traffic |
| Controlled failures | Post-commit loss, worker restart, concurrent repeat and stale-version cases | No second effect for the same protected intent; ambiguous evidence never becomes a false confirmation |
| Recovery review | Receipts, spans, held-action explanation and documented operational decisions | A reviewer can identify the actual resource or explain why it is unresolved |
| Commercial decision | Findings, operational burden and a scoped continuation proposal | A named buyer decides whether the capability is worth funding |

A reasonable initial scheduling hypothesis is two weeks **after** the provider contract, access and scope are agreed. That is not a fixed delivery commitment. Hosted-service compatibility and provider read consistency may require revising the scope.

## Success measures

Report duplicate effects and false confirmations separately; measure healthy completion, uncertain actions still held, reconciliation latency and reviewer time. Do not count every held action as successfully completed. Require exact resource/account matching, including negative cases with zero or multiple matches.

The first live validation should use a disposable calendar and a test notification channel. Production identity, encryption, retention, external consistency, lease/fencing rules and multi-region storage remain outside this prototype and must be designed before broader use.

## Commercial shape

The technical review is an introduction. Any paid work needs a mutually agreed scope, deliverables and fee. The longer-term hypothesis is a maintained recovery/evidence layer with provider packs and workflow integrations. There is no request for acquisition or unsupported valuation here.

I am interested in turning this work into a funded pilot or an engineering opportunity, with the technical demonstration as the starting point.
