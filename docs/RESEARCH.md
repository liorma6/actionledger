# Research memo: where an action-recovery product might earn its place

Research date: **17 November 2026**. Findings below separate documented facts, observed local behavior and commercial hypotheses. This is not customer validation or a valuation.

## Decision

Build a standalone **action outcome and recovery** pilot for the Composio ecosystem. Start with a calendar write followed by a notification. The important question is not only whether the model chose a valid tool, but whether an externally visible action happened and whether the caller can safely continue.

Composio is a relevant first design-partner target because its integration boundary connects agent decisions to real services. Its issue discussions and production guidance explicitly describe ambiguous write outcomes. That makes the technical need credible. It does **not** show an unfilled budget, a large affected population or an intention to buy this product.

## Evidence ledger

| Primary evidence | What it supports | What it does not establish |
| --- | --- | --- |
| [Composio retry guidance](https://docs.composio.dev/kb/guide/sdk-tool-execution-retries) | Current SDKs disable automatic execution retries; timeouts can still be ambiguous, and manual retries need verification | That the current SDK still automatically duplicates writes |
| [Composio #3654](https://github.com/ComposioHQ/composio/issues/3654), open when reviewed | A discussed backend idempotency contract, input/key binding and unresolved or pending outcomes; assigned work already exists | That this pilot is the first proposal, fixes the backend, or should replace the assigned maintainer |
| [Production readiness guidance](https://docs.composio.dev/docs/production-readiness) | Production applications must account for execution behavior and failures | Frequency or financial impact of incidents |
| [Composio #5343](https://github.com/ComposioHQ/composio/issues/5343), open when reviewed | A request to expose optional If-Match for calendar patching | A live reproduction of that toolkit issue; our pilot uses proxy execution |
| [Google Calendar versioned resources](https://developers.google.com/workspace/calendar/api/guides/version-resources) | Conditional updates and 412 on version mismatch; insertion has different semantics | That our small twin implements Google's full API or its actual consistency behavior |
| [Composio #4953](https://github.com/ComposioHQ/composio/issues/4953) | Synthetic execution regression coverage has already been proposed | Novelty of merely adding fault tests |
| [Official partnerships page](https://composio.dev/partnerships) | A public infrastructure/developer-platform partnership channel | That this inbox is an engineering hiring manager or will accept the proposal |

The pilot reproduces the *class of failure* locally through the published SDK. It does not claim to reproduce a current Composio cloud defect. The SDK version, measured requests, receipts and provider state are included in the evidence bundle.

## Other opportunities examined

| Candidate | Why it initially looked useful | Why it was not the chosen pilot |
| --- | --- | --- |
| Permit authorization regression replay | Regressions can grant or remove access unexpectedly | [Permit already documents authorization testing and audit-log replay](https://docs.permit.io/how-to/sdlc/authz-testing/). A generic replay wrapper would have weak differentiation. |
| dlt/Airbyte schema changes → downstream impact review | A pipeline can run successfully while breaking business assumptions | [dlt schema contracts](https://dlthub.com/docs/general-usage/schema-contracts) and [Datafold data diffs](https://www.datafold.com/data-diff/) already cover substantial parts. A credible gap would need a narrow buyer workflow and real datasets. |
| Generic agent evaluations / tool-call dashboards | Agent failures are hard to inspect | [Langfuse evaluation](https://langfuse.com/docs/evaluation/overview) and [Arcade](https://docs.arcade.dev/) already offer relevant tracing/evaluation capabilities. A prettier trace view alone is not a strong product thesis. |
| Provider-specific uncertain-action recovery | Durable intent plus authoritative outcome evidence can stop dangerous repeats and release safe follow-on work | Selected as a **hypothesis**, because integration-specific recovery knowledge might become reusable and valuable. Existing infrastructure still poses a serious competitive risk. |

## Closest substitutes, not straw men

**Temporal.** Its [activity guidance](https://docs.temporal.io/activity-definition) explicitly discusses idempotency and the case where an activity completes but the worker fails before reporting completion. Receiving services enforce idempotency keys. Temporal also has an [agent gateway example](https://docs.temporal.io/ai/featured/agent-gateway-nexus). ActionLedger is not a replacement workflow engine. A possible integration would store/inspect action receipts around an activity whose external outcome is ambiguous, with a deliberately compatible retry policy.

**DBOS.** Its [architecture documentation](https://docs.dbos.dev/architecture) describes checkpointed execution and requires idempotent steps because recovery can repeat an unfinished step. Its [workflow IDs](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) already support workflow deduplication. Our opportunity, if any, lies in verified external-effect reconciliation, not inventing durable IDs or a workflow database.

**Restate.** Its [durable-execution design](https://restate.dev/blog/why-we-built-restate) records side-effect results, while acknowledging that a side effect may execute again before its result is durable. A provider-specific receipt/reconciliation pack might complement that boundary. A Restate integration is **not implemented** here.

**Langfuse / Arcade / stateful agent benchmarks.** These already cover observability, tool execution or evaluation. [ToolSandbox](https://aclanthology.org/2025.naacl-findings.65/) already evaluates stateful tool interaction. We do not claim state-based testing is new. The proposed product responsibility is different: bind a live write intent, preserve uncertainty and decide whether evidence permits progress. Even that distinction must be tested in buyer interviews.

**Native Composio changes.** The platform can implement the backend contract itself. This is the largest strategic risk. An extension that is easy to absorb may be useful portfolio work or a paid implementation project without becoming an independent venture.

## Product hypothesis and distribution

The entry product would be an **action recovery console plus provider capability packs**, not a generic AWS replica or another model-answer scorecard. Each pack specifies stable correlation, idempotency support, version preconditions, consistency assumptions, evidence reads and situations requiring review. Teams can rehearse the same contract in CI and use the receipts during an incident.

The initial buyer hypothesis is a platform/engineering lead shipping agents that create or change important operational records across several APIs. The hypothesized economic benefit is less incident investigation and less manual cleanup, plus confidence to enable useful write actions. Neither benefit is quantified yet.

The distribution hypothesis is a Composio integration/reference implementation, followed by one workflow-engine adapter. The SDK and trial pack could be open source; managed history, organization review, retained evidence and validated provider packs could be commercial. These are proposed future features, not current capabilities. The MIT pilot does not convey exclusivity to a prospective buyer.

## How this could become a substantial business

The code wrapper is not a defensible moat. Possible defensibility would require a tested catalog of provider failure/reconciliation contracts, maintained compatibility, adoption inside production workflows, operational trust, and paid distribution. Creating that is materially harder than this prototype.

A $5 million sale is a goal, not an evidence-based price for this repository. There are no customers, revenue, proprietary incident corpus or acquisition offers established by this work. A buyer would need a strategic reason, defensible assets or proven recurring economics. We should earn that evidence instead of putting an unsupported valuation into outreach.

Near-term progression:

1. Ask an engineering owner to challenge the semantics and identify one real workflow with costly ambiguous outcomes.
2. Interview 8–10 platform/agent builders; obtain concrete, permissioned incident examples and understand their current recovery process.
3. Seek two design partners willing to provide disposable test environments and an identified budget owner.
4. Scope one paid validation project. A possible **pricing experiment** is a $5k–15k fixed engagement; this is neither a validated market rate nor an offer already accepted.
5. Measure review time, resolved versus held actions, false confirmations and provider coverage. Retain a healthy-work completion metric so a system that blocks everything cannot appear successful.

Kill or reposition the venture if native idempotency and existing workflows solve the problem adequately, reconciliation is too unreliable, teams cannot supply incidents or no buyer will fund validation. In that case this remains a strong engineering demonstration rather than a claimed company.

## What this pilot establishes

Local fault injection through an actual published SDK can expose repeat effects, detect conflicting intent reuse, protect a versioned update, and preserve an uncertain result across restart. A human can inspect why a dependent action was held. It establishes an implementation mechanism under specified assumptions. It does not establish hosted-service correctness, production security, market size or commercial demand.
