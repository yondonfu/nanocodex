# Speculative Programmatic Tool Calling Task Tracker

This tracker executes [`SPEC_PTC_PLAN.md`](SPEC_PTC_PLAN.md). The plan owns the
architecture and safety rationale; this file owns task status, milestone order,
end-to-end flows, evidence, and stop decisions.

## Tracker rules

- Complete milestones in order. Do not begin runtime implementation before
  Milestones 0 and 1 pass.
- Mark a checkbox complete only when its code, focused validation, retained
  evidence, and milestone end-to-end flow are complete.
- Every milestone must exercise the real consumer boundary named in its
  end-to-end flow. Unit tests alone do not complete a milestone.
- Stop at the highest owning boundary on a correctness, isolation, security,
  or benchmark failure. Fix it before proceeding.
- Preserve byte-identical model-visible requests and ordinary behavior in every
  disabled or missed-speculation flow.
- Keep raw reports and unredacted traces under `.nanocodex/` or on
  `dev-georgios`, outside Git. Commit deterministic extractors, sanitized
  derived workloads, schemas, report hashes, and dated summaries.
- Milestone 0 may merge independently. Milestones 2 through 6 remain on the
  focused prototype branch. They merge only through Milestone 7 after the ship
  decision passes. If the decision is delete, remove their runtime/API surface
  before merging retained benchmark evidence.
- Follow the active order in `PLAN.md`. Do not start Milestone 0 until the
  focused Code Mode parity slice and following Codex checkpoint review have
  landed, unless the repository owner explicitly reprioritizes this work.
- Do not add this implementation to `PLAN.md` until Milestone 1 accepts both
  the feasibility evidence and the precommit-effect contract.

## Status legend

- `[ ]` pending
- `[x]` completed with retained evidence

## Milestone map

| Milestone | Outcome | Real end-to-end consumer | Merge policy |
| --- | --- | --- | --- |
| 0. Reproducible feasibility baseline | A user can measure whether the feature is worth building | `spec-ptc-bench` feasibility mode over retained derived traces | May merge independently |
| 1. Contract and frozen experiment | The owner gets a reproducible proceed/stop report and accepts or rejects precommit execution | Feasibility report plus explicit contract decision | May merge documentation/evidence only |
| 2. Attempt-aware streamed input | A real agent completes normally while the benchmark distinguishes retry/fallback attempts without slowing transport | Scripted Tower service through `Nanocodex` | Prototype branch only |
| 3. One exact speculative claim | A caller-defined delayed lookup starts during streaming and is claimed once by the authoritative cell | Full agent, QuickJS, tool, follow-on model response | Prototype branch only |
| 4. First-wave concurrency and cell state | Concurrent first-wave calls claim deterministically; dependent and stale-state calls safely miss | Full agent program-shape suite | Prototype branch only |
| 5. Failure, cancellation, and isolation | Failed, retried, cancelled, overflowing, forked, and resumed flows cannot cross-claim or leak owned work | Full agent lifecycle suite | Prototype branch only |
| 6. Performance ship/delete decision | A benchmark operator receives an auditable gate decision from local replay and `dev-georgios` evidence | Complete `spec-ptc-bench` matrix | Prototype branch; delete on failure |
| 7. Public opt-in feature | A library user can double-opt in, observe speculative activity, cancel safely, and retain normal defaults | Public example and typed event stream | Merge as one release-coordinated vertical slice |

---

## Milestone 0 — Reproducible feasibility baseline

### Outcome

A benchmark operator can analyze representative retained Code Mode traces
without executing any tool and receive a content-addressed report describing
first-wave reachability, available overlap, exclusions, and projected benefit.

### Tasks

- [ ] Confirm the prerequisite Code Mode and Codex checkpoint work has landed;
  record the reviewed Nanocodex commit in the report metadata.
- [ ] Identify at least one real embedding consumer and its statically
  registered caller-defined tools that could plausibly satisfy the eventual
  speculation-safety contract.
- [ ] Record the eligibility classification for every tool in the selected
  corpus; do not count built-ins, MCP/deferred tools, or invented tools as
  positive evidence.
- [ ] Define a sanitized derived trace schema containing item identity shape,
  source deltas and timing, item-done/completed timing, program-shape flags,
  tool name class, recorded tool duration, and live-cell/store-state facts.
- [ ] Implement a deterministic extractor from retained full-fidelity traces to
  that schema.
- [ ] Add an intercept-only QuickJS dry host that records first-wave tool calls
  from a prefix but never invokes a registered handler.
- [ ] Add the conservative lexical admission scan for feasibility analysis:
  strings, templates, escapes, comments, balanced delimiters, and newly closed
  eligible `tools.<name>(...)` expressions.
- [ ] Compute for each `exec`: first lexically admitted prefix, first dry-host
  call, first-wave eligibility, time to item done, time to response completion,
  tool latency, and recoverable overlap.
- [ ] Classify timer, `Date`, `Math.random`, dependent continuation, deferred
  discovery, duplicate declaration/hoisting, multiple-`exec`, and live/yielded-
  cell exclusions.
- [ ] Calculate both partial-prefix and complete-item projected benefit so the
  safer launch boundary can be preferred when it retains enough value.
- [ ] Add `spec-ptc-bench` feasibility mode to `nanocodex-examples`, using
  environment controls and JSON reporting consistent with
  `response-transport-bench`.
- [ ] Commit the extractor, sanitized derived workload, selection procedure,
  schema, corpus hash, structural histograms, and deterministic expected
  report.
- [ ] Keep raw unredacted traces outside Git and record their content hashes and
  storage location in the local run evidence.
- [ ] Verify repeated runs over the same derived workload produce the same
  classifications and projected metrics.

### End-to-end user flow

The benchmark operator runs:

```sh
SPEC_PTC_BENCH_MODE=feasibility \
SPEC_PTC_BENCH_INPUT=benchmarks/spec-ptc/derived-workload.json \
SPEC_PTC_BENCH_OUTPUT=.nanocodex/benchmarks/spec-ptc-feasibility.json \
  cargo run --release -p nanocodex-examples --bin spec-ptc-bench
```

The command must:

- execute no real tool handler;
- validate the derived corpus hash and schema;
- report eligible-program count, first-wave reachability, partial-prefix and
  complete-item overlap distributions, projected eligible-turn p50 benefit,
  exclusions, and concentration by tool/program shape; and
- return a deterministic `proceed`, `stop`, or `insufficient_evidence`
  recommendation with the reasons encoded in JSON.

### Milestone acceptance

- [ ] The end-to-end flow passes twice from a clean checkout with identical
  semantic report content.
- [ ] A reviewer can recompute the recommendation using only committed derived
  data and documented commands.
- [ ] The report names a real consumer and real eligible-tool candidates.

### Stop gate

Stop the feature if evidence is insufficient, fewer than half of representative
eligible `exec` programs expose a first-wave candidate, projected eligible-turn
p50 benefit is below 5%, or the opportunity is concentrated in one trace,
tool, or pathological shape. Retain this milestone as the negative result.

---

## Milestone 1 — Contract decision and frozen experiment

### Outcome

The repository owner can inspect one reproducible baseline report and make an
explicit decision about the launch boundary, precommit effects, public
observability, private limits, benchmark weights, and ship/delete thresholds.

### Tasks

- [ ] Review the Milestone 0 report and select partial-prefix or complete-item
  launch. Select complete-item unless measured benefit requires partial source.
- [ ] Approve or reject the replacement runtime invariant allowing explicitly
  opted-in handlers to run before `response.completed`.
- [ ] Freeze the handler contract covering uncommitted arguments, duplicates,
  concurrency, abandonment, cancellation limits, quota/cost, result freshness,
  and lack of a shared idempotency key.
- [ ] Freeze first-slice scope: native, one `exec`, static registrations,
  first-wave only, no live cells, no dynamic providers, and no built-ins.
- [ ] Freeze the private source, evaluation, launch, concurrency, wall/CPU,
  heap, stack, timer, and logical-call limits from the baseline evidence.
- [ ] Freeze successful-workload and lifecycle-stress weights separately.
- [ ] Freeze sample-sizing procedure, paired confidence-interval method,
  performance thresholds, amplification/discard denominators, reliability
  gates, and the 1-4% `do not ship` outcome.
- [ ] Specify the proposed graduated API:
  `ToolsBuilder::speculative_tool` plus default-false native
  `NanocodexBuilder::speculative_programmatic_tool_calls`.
- [ ] Specify provisional `ToolContext::call_id` semantics and guarantee that
  speculative IDs cannot collide with authoritative IDs.
- [ ] Specify distinct typed speculative lifecycle events and a terminal
  summary; do not overload ordinary `ToolEvent`.
- [ ] Inventory the required event/projection compatibility changes for
  `AgentEventKind`, `RunMetrics`, `TurnResult`, JSONL, Python, Node, and WASM.
- [ ] Update `SPEC_PTC_PLAN.md` if Gate 1 evidence changes the selected launch
  boundary, limits, scope, or metrics.
- [ ] Add the accepted implementation slice to `PLAN.md` in the correct active
  order only after every preceding decision is complete.
- [ ] Record an explicit signed-off `proceed` or `stop` decision in the dated
  benchmark summary.

### End-to-end user flow

The repository owner reruns feasibility mode from Milestone 0 and opens the
generated decision summary. The summary must link each frozen contract choice
and threshold to the measured report field that motivated it. A fresh
`spec-ptc-bench` run must reproduce the same decision without editing prompts,
workloads, or thresholds.

### Milestone acceptance

- [ ] The owner explicitly accepts the precommit-effect invariant in writing.
- [ ] The launch boundary and all private limits are fixed before enabled
  runtime results exist.
- [ ] Public compatibility work is scheduled rather than hidden inside private
  runtime commits.
- [ ] `PLAN.md` records the slice only after both gates pass.

### Stop gate

If the invariant or safety contract is rejected, mark this milestone stopped,
do not implement Milestones 2-7, and retain the benchmark as evidence. A
post-completion optimizer would require a separate plan and name.

---

## Milestone 2 — Attempt-aware streamed input through a real agent

### Outcome

A normal `Nanocodex` turn driven by a scripted concrete Tower service can
observe one bound `exec` stream across ordinary retry and WebSocket-to-HTTPS
fallback using unique physical tokens, while producing the same `TurnResult`,
events, history, and transport timing as the observer-disabled baseline.

### Tasks

- [ ] Add a private opaque `PhysicalAttemptToken` that is monotonically unique
  for every physical transport send and never serialized or exposed publicly.
- [ ] Mint a new token for the first send, ordinary retry, and transport
  fallback even when the diagnostic attempt number resets to one.
- [ ] Add the private attempt lifecycle envelope with logical call index,
  physical token, diagnostic attempt/transport, raw item ID, raw call ID,
  synthesized-identity marker, and required response events.
- [ ] Preserve raw item ID and call ID separately; represent call-ID-only
  identity without copying it into an item-ID field.
- [ ] Bind speculation input only after
  `OutputItemAdded(ResponseItem::CustomToolCall { name: "exec", ... })`.
- [ ] Poison unbound, ambiguous, renamed, duplicated, or identity-changing
  items.
- [ ] Attach a private bounded observer only when the prototype policy and an
  eligible registration are present.
- [ ] Deliver observation with `try_send`; never await the consumer from the
  provider decode path.
- [ ] Add an independent poison/invalidation signal so queue overflow cannot
  strand attempt-owned work.
- [ ] Preserve public `ResponseEvent`, the generic concrete Tower service,
  SDK-owned retry policy, and one-call-through-terminal semantics.
- [ ] Make `ResponsesAttempt::emit` participate in the same physical token for
  caller-supplied scripted services.
- [ ] Add focused tests for initial success, aggregate-only completion, missing
  binding, call-ID-only binding, ordinary retry, transport fallback with
  identical bytes/IDs, failure/incomplete response, slow observer, dropped
  observer, and channel overflow.
- [ ] Extend `spec-ptc-bench` with `transport_lifecycle` mode and exact request,
  event, response, and timing digests.

### End-to-end user flow

The benchmark operator runs:

```sh
SPEC_PTC_BENCH_MODE=transport_lifecycle \
SPEC_PTC_BENCH_OUTPUT=.nanocodex/benchmarks/spec-ptc-transport.json \
  cargo run --release -p nanocodex-examples --bin spec-ptc-bench
```

The scripted service emits a partial `exec`, fails the first WebSocket path,
replays identical IDs and bytes through HTTPS attempt `1`, and completes. The
real agent must return the deterministic final `TurnResult`. The report must
show two distinct opaque physical tokens, no cross-attempt binding, identical
model-visible request/history/event digests, and no observer-caused delay or
failure.

### Milestone acceptance

- [ ] The observer-disabled and observer-enabled full-agent results and ordinary
  events are byte-identical.
- [ ] Every physical send has a unique token under retry and fallback.
- [ ] Slow, full, or dropped observation never delays model completion.
- [ ] No shadow host or tool handler exists yet; this milestone cannot execute
  speculative effects.

---

## Milestone 3 — One bounded first-wave call and exact claim

### Outcome

A caller-defined delayed lookup launches once from a streamed first-wave
prefix, remains quarantined until successful completion, and is claimed once by
the authoritative QuickJS cell. Enabled and disabled variants produce the same
follow-on request, committed snapshot, events after filtering speculative
diagnostics, and final answer.

### Tasks

- [ ] Add private per-registration speculation metadata to
  `nanocodex-tools`; do not change the `Tool` trait.
- [ ] Require both registration eligibility and
  `supports_parallel_tool_calls() == true` before launching.
- [ ] Add Code Mode live-cell exclusion and a monotonic stored-state epoch.
- [ ] Snapshot stored JSON plus epoch only while no cell is live; validate the
  epoch again at authoritative admission.
- [ ] Add the bounded conservative lexical prefix scanner selected in
  Milestone 1.
- [ ] Add a disposable shadow QuickJS worker with the frozen heap, stack,
  source, evaluation, and wall/CPU limits.
- [ ] Abort shadow use of `Date`, `Math.random`, timers, `notify`,
  `yield_control`, unknown/ineligible tools, and unsupported host effects.
- [ ] Keep shadow `text`, `store`, and `load` local and uncommitted.
- [ ] Add private `FirstWaveSealed` to the embedded-host protocol after the
  initial synchronous invocation and before later microtasks or tool results.
- [ ] Return never-resolving promises from shadow tool calls so speculative
  results cannot launch dependent work.
- [ ] Create the exact candidate key from logical call, physical token, raw
  `exec` identity, canonical name/input, and per-key ordinal.
- [ ] Canonicalize object keys recursively while preserving types, arrays, and
  separate identical-call ordinals.
- [ ] Enforce one item, one evaluator, logical-call-wide evaluation/launch
  budgets, and private concurrency limits.
- [ ] Create a unique provisional `ToolContext::call_id` that cannot collide
  with authoritative nested-call IDs.
- [ ] Capture completed/in-flight `ToolOutput` in a one-shot ledger without
  exposing it to history, stored state, or ordinary events.
- [ ] Require exact physical token, raw identity, initial-input-plus-delta
  source, finalized `CodeCall`, stored epoch, name/input, and ordinal before
  sealing or claiming.
- [ ] Integrate claim-or-execute immediately before authoritative nested tool
  dispatch.
- [ ] Attach the sealed ledger to the authoritative `LiveCell`; cancel
  unmatched leftovers at the correct cell terminal boundary.
- [ ] Add full-fidelity physical speculation tracing with complete source,
  arguments, results, provisional identity, timing, and disposition.
- [ ] Add focused tests for valid prefix, incomplete syntax, exact hit, source
  mismatch, item mismatch, stale epoch, ineligible/parallel-unsafe tool,
  handler success/error/panic, deadline, memory limit, and late completion.
- [ ] Extend `spec-ptc-bench` with paired `single_call` enabled/disabled mode.

### End-to-end user flow

The benchmark operator runs:

```sh
SPEC_PTC_BENCH_MODE=single_call \
SPEC_PTC_TOOL_LATENCY_MS=1000 \
SPEC_PTC_DECODE_REMAINING_MS=1000 \
SPEC_PTC_BENCH_OUTPUT=.nanocodex/benchmarks/spec-ptc-single-call.json \
  cargo run --release -p nanocodex-examples --bin spec-ptc-bench
```

The scripted model streams one `exec` calling an eligible deterministic lookup,
waits one second before `response.completed`, consumes its Code Mode output in
the next request, and returns a fixed answer. The enabled run must start the
handler before model completion, execute it physically exactly once, claim it
once, and finish materially earlier. Disabled and enabled runs must have exact
matching final answers, authoritative tool result, follow-on request digest,
snapshot, model usage, and ordinary event subsequence.

### Milestone acceptance

- [ ] The end-to-end flow proves one early physical launch and one authoritative
  claim with no second handler execution.
- [ ] Disabled mode creates no observer, shadow worker, task, or ledger.
- [ ] Every mismatch executes normally and cannot claim the speculative result.
- [ ] Full observed speculative data appears in tracing but nowhere in history
  before claim.

---

## Milestone 4 — First-wave concurrency, matching, and cell state

### Outcome

The full agent deterministically claims concurrent first-wave calls under
jitter, preserves separate identical invocations, refuses dependent second-wave
calls, and safely falls back when Code Mode state is live or stale.

### Tasks

- [ ] Support up to the frozen speculative concurrency and logical-call launch
  limits without changing the existing ordinary nested-tool scheduler.
- [ ] Prove `FirstWaveSealed` classification is identical for fixed, jittered,
  immediately ready, and adversarial handler completion order.
- [ ] Reuse a candidate slot only for the same `(name, canonical input,
  ordinal)` across longer-prefix re-evaluation.
- [ ] Keep separate identical first-wave calls in separate slots and reject
  double claims.
- [ ] Stop claims after the authoritative `FirstWaveSealed` marker so calls
  reached after an awaited result execute normally.
- [ ] Poison speculation if a second `exec` item appears in the response.
- [ ] Enforce the logical-call launch budget across every physical retry rather
  than resetting it per attempt.
- [ ] Preserve first-wave `Promise.all` concurrency while keeping sequential
  dependent calls out of speculation.
- [ ] Add hoisting-divergence cases that may launch abandoned arguments but
  never claim the wrong result.
- [ ] Add nondeterministic-global and timer cases that abort before launch or
  produce a bounded miss according to the frozen policy.
- [ ] Prevent snapshot creation while any cell is live or yielded.
- [ ] Increment stored-state epoch on cell terminal commits and reject a ledger
  whose epoch changes before authoritative admission.
- [ ] Retain a claimed/unclaimed ledger in `LiveCell` across an `exec` yield and
  later `wait`; drain it only at the defined cell/runtime boundary.
- [ ] Add matrix tests for `Promise.all`, sequential awaits, loops, duplicate
  inputs, reordered keys, conditional calls, mixed eligibility, live cell,
  yielded cell, store commit during decode, stale epoch, and multiple `exec`s.
- [ ] Extend `spec-ptc-bench` with `program_shapes` mode and exact per-call
  physical/logical timelines.

### End-to-end user flow

The benchmark operator runs:

```sh
SPEC_PTC_BENCH_MODE=program_shapes \
SPEC_PTC_BENCH_OUTPUT=.nanocodex/benchmarks/spec-ptc-program-shapes.json \
  cargo run --release -p nanocodex-examples --bin spec-ptc-bench
```

The suite drives the real agent through:

1. four jittered first-wave `Promise.all` calls, including two identical calls;
2. a sequential dependent second call;
3. a yielded cell followed by `wait`; and
4. a prior cell committing stored state during model decode.

The first case must claim four distinct results with output identical to the
disabled run regardless of completion order. The dependent call must execute
normally after the first-wave marker. Live/stale-state cases must launch or
claim nothing and still produce the exact disabled result.

### Milestone acceptance

- [ ] All program-shape output, snapshot, request, usage, and ordinary-event
  digests match disabled mode.
- [ ] Identical calls remain distinct and no result is swapped under jitter.
- [ ] No result-dependent speculative chain can occur.
- [ ] Yielded/live/stale state produces a safe miss with no state divergence.

---

## Milestone 5 — Failure, cancellation, retry, and isolation

### Outcome

A user can fail, retry, fall back, steer, cancel, fork, resume, overflow, or
shut down an enabled agent and receive the same authoritative semantics as the
disabled agent, with all physical speculative work accounted for and no
cross-boundary claim or owned-task leak.

### Tasks

- [ ] Cancel and invalidate a physical session immediately when a new opaque
  attempt token starts; never reuse old results even when bytes and IDs repeat.
- [ ] Preserve the logical-call launch budget across ordinary retry and
  WebSocket-to-HTTPS fallback.
- [ ] Cancel unsealed work on failed, incomplete, malformed, or aggregate-only
  responses.
- [ ] Handle turn cancellation before launch, during the handler, after handler
  completion, and before authoritative claim.
- [ ] Handle steering that abandons the current run without admitting stale
  candidates to the replacement run.
- [ ] Hold Code Mode admission closed while runtime shutdown cancels and drains
  speculative and ordinary work.
- [ ] Preserve existing retained-shell behavior; speculative eligibility never
  includes shell handlers.
- [ ] Isolate clean children, forks, resumed sessions, and durable model-step
  replay from parent or prior ledgers and physical tokens.
- [ ] Make observer overflow atomically poison and cancel the affected session
  without transport backpressure.
- [ ] Ensure dropping a handler future emits a physical cancelled/discarded
  trace even though an external request may continue beyond SDK control.
- [ ] Record private terminal counters for evaluations, launches, claims,
  discards, peak concurrency, work, hidden time, post-claim wait, observer
  overflow, worker replacement, and handler/rate-limit errors.
- [ ] Never retry a speculative handler inside Nanocodex.
- [ ] Add full-fidelity trace-parent tests for overlapping model, speculation,
  authoritative claim, retry, cancellation, and shutdown branches.
- [ ] Add lifecycle integration tests for failure, incomplete response,
  ordinary retry, transport fallback, cancel, steer, overflow, fork, child,
  snapshot/resume, durable replay, and shutdown.
- [ ] Extend `spec-ptc-bench` with `lifecycle` mode and an owned-task leak check.

### End-to-end user flow

The benchmark operator runs:

```sh
SPEC_PTC_BENCH_MODE=lifecycle \
SPEC_PTC_BENCH_OUTPUT=.nanocodex/benchmarks/spec-ptc-lifecycle.json \
  cargo run --release -p nanocodex-examples --bin spec-ptc-bench
```

The suite must include:

- a first physical attempt that launches a call, fails, and falls back with
  identical program bytes and provider IDs;
- a user cancellation while a speculative handler is in flight;
- a saturated observer queue;
- a clean child and fork after the parent used speculation; and
- snapshot/resume plus durable replay without a live delta stream.

The fallback result may claim only from the successful physical token. The
cancelled run must emit one terminal cancellation and account for abandoned
work without committing response/tool data. Overflow must not delay the model.
Children, forks, resumes, and replay must produce correct results with no
parent-ledger hit. Shutdown must leave no owned task, shadow worker, or claimable
entry.

### Milestone acceptance

- [ ] The complete lifecycle suite matches disabled authoritative semantics.
- [ ] No test can claim across attempt, item, call, cell, turn, fork, resume, or
  agent boundaries.
- [ ] Every accepted prompt emits exactly one existing terminal run boundary.
- [ ] Cancellation and shutdown leave no SDK-owned speculative work.
- [ ] Trace evidence accounts for every launched physical call, including
  abandoned work that never entered history.

---

## Milestone 6 — Auditable performance ship/delete decision

### Outcome

A benchmark operator can run one frozen local/replay matrix and one live
supporting flow on `dev-georgios`, then receive an auditable `ship` or `delete`
decision based on predeclared correctness, latency, waste, reliability, and
resource gates.

### Tasks

- [ ] Finish Criterion coverage for disabled construction, no eligible tools,
  no viable prefix, no launch, all discard, token-level malformed prefixes,
  canonicalization, hit/miss, deadlines, memory limits, and forced interrupts.
- [ ] Finish the scripted full-agent matrix for eligible calls 1/2/4/8, tool
  latency 50/250/1000 ms, decode remaining 0/250/1000 ms, and fixed/jittered
  completion order.
- [ ] Include every program semantics, matching, eligibility, Code Mode state,
  lifecycle, stream quality, outcome, and quota row frozen in the plan.
- [ ] Keep enabled/disabled model-visible requests, delta schedules, final
  responses, tool outputs, retry schedules, and follow-on responses byte-
  identical.
- [ ] Rotate pair order and derive sample count from disabled variance before
  collecting candidate results.
- [ ] Compute paired confidence intervals for prompt-to-terminal p50 and p95;
  do not treat small sample counts as tail evidence.
- [ ] Define successful representative and forced lifecycle denominators
  separately in the report.
- [ ] Record overlap, evaluations, launches, claims, misses, discards, physical
  calls, useful/hidden/wait/abandoned work, CPU, RSS, worker replacement,
  handler errors, 429/rate limits, model usage, request bytes, and exact
  semantic digests.
- [ ] Run the complete deterministic release build locally and retain raw JSON
  plus report hash outside Git.
- [ ] Deploy fresh `origin/master` plus the focused branch to
  `ubuntu@dev-georgios` without disturbing unrelated services or profiles.
- [ ] Run the retained derived workload on `dev-georgios` and retain exact
  source revision, command, environment, raw report, traces, and system resource
  evidence.
- [ ] Run alternating enabled/disabled live supporting pairs with the same
  cache identity and model-visible configuration.
- [ ] Treat live latency as non-binding; block on any correctness/isolation
  failure or material increase in handler/rate-limit/terminal failure rate.
- [ ] Evaluate every graduation gate exactly as frozen in Milestone 1.
- [ ] Write a dated summary with corpus/extractor/source/report hashes,
  confidence intervals, gate table, anomalies, and explicit `ship` or `delete`.
- [ ] If the decision is `delete`, remove the private observer attachment,
  registration metadata, shadow runtime, agent policy, and branch-only example
  path; retain the reusable benchmark and negative result.

### End-to-end user flow

The benchmark operator first runs the frozen local suite:

```sh
SPEC_PTC_BENCH_MODE=all \
SPEC_PTC_BENCH_INPUT=benchmarks/spec-ptc/derived-workload.json \
SPEC_PTC_BENCH_OUTPUT=.nanocodex/benchmarks/spec-ptc-full.json \
  cargo run --release -p nanocodex-examples --bin spec-ptc-bench
```

The exact source is then built and exercised on `ubuntu@dev-georgios` with the
documented environment. The committed summary consumes both reports and emits
one decision. A reviewer must be able to validate each gate from the report and
committed derived workload without rerunning the live model.

### Milestone acceptance

- [ ] Correctness, isolation, disabled-cost, miss-cost, lifecycle, and resource
  gates pass with no unexplained exception.
- [ ] The paired 95% confidence interval shows at least 5% representative p50
  benefit and acceptable p95 regression.
- [ ] Successful representative amplification is at most 1.05 and discard rate
  at most 5%; forced lifecycle waste is reported separately.
- [ ] Reliability shows no material handler, 429, transport, or terminal-error
  regression.
- [ ] The decision is reproducible and explicitly `ship` or `delete`.

### Stop gate

An improvement of 1-4%, a failed final gate, or non-reproducible decisive
evidence means `delete`. Do not retain an unproven runtime or public API in an
indefinite experimental state.

---

## Milestone 7 — Public default-off opt-in feature

### Outcome

A native library user can run the documented public example in three modes:
ordinary default behavior, globally enabled with an ordinary ineligible tool,
and double-opted-in speculative behavior. Only the third mode executes early;
all modes return the same authoritative answer and history. The enabled user
can observe every speculative launch/result/claim/discard and a terminal
summary through typed events.

### Tasks

- [ ] Add the native-only default-false
  `NanocodexBuilder::speculative_programmatic_tool_calls(bool)` policy.
- [ ] Add public `ToolsBuilder::speculative_tool` registration metadata without
  changing model-visible definitions or the `Tool` trait.
- [ ] Ensure global enablement alone and eligible registration alone are each
  insufficient to launch speculation.
- [ ] Preserve model-facing tool order, system/developer instructions, request
  prefix, cache fingerprint, prompt-cache key, and finalized `exec` source.
- [ ] Inherit agent policy through clean-child and fork recipes; use the new
  builder's policy on resume and serialize no speculation state.
- [ ] Make the builder method unavailable—not a no-op—under the existing native
  target-gating convention.
- [ ] Add distinct typed speculative launch, result, claim, and discard events
  with complete arguments/results and provisional identity.
- [ ] Add a nested non-exhaustive terminal speculation summary and an additive
  successful `TurnResult` accessor.
- [ ] Coordinate required `AgentEventKind`, projection, and `RunMetrics`
  extensibility changes with the selected public-contract release.
- [ ] Preserve existing ordinary `ToolEvent` semantics and prove that filtering
  speculative events yields the disabled ordinary event sequence.
- [ ] Include speculation summary on completed, failed, and cancelled terminal
  event projections.
- [ ] Update JSONL protocol encoding/decoding and exact fixture coverage.
- [ ] Update Python and Node projection/binding consumers without reshaping the
  owned Rust session contract.
- [ ] Validate unchanged hosted/WASM builds and document target-gated usage.
- [ ] Add public API docs covering partial/uncommitted arguments, abandonment,
  cancellation limits, provisional IDs, duplicate/concurrent calls, result
  freshness, quota/cost, trace retention, and static eligibility.
- [ ] Add a concise public example using a deterministic delayed eligible tool
  and the typed event stream.
- [ ] Update changelogs and migration notes from the actual public surface.
- [ ] Run focused rustfmt, warnings-denied Clippy, affected tests, public
  examples, crate-boundary checks, JSONL adapters, language bindings, native
  live smoke, and hosted/WASM compatibility at final handoff.
- [ ] Merge only with the Milestone 6 retained `ship` evidence linked from the
  change.

### End-to-end user flow

The library user runs the public example in each mode:

```sh
SPEC_PTC_EXAMPLE_MODE=default \
  cargo run --release -p nanocodex-examples --bin speculative-tool-calls

SPEC_PTC_EXAMPLE_MODE=global_only \
  cargo run --release -p nanocodex-examples --bin speculative-tool-calls

SPEC_PTC_EXAMPLE_MODE=double_opt_in \
  cargo run --release -p nanocodex-examples --bin speculative-tool-calls
```

Expected behavior:

- `default`: the tool starts only after `response.completed`; no speculative
  resources, events, or summary activity exist.
- `global_only`: behavior remains identical because the tool registration did
  not opt in.
- `double_opt_in`: the tool starts during the streamed first wave, emits typed
  speculative launch and result events, is claimed exactly once by the
  authoritative cell, emits the ordinary logical nested-tool events in program
  order, and returns a populated terminal summary.

All three modes must return the same final message, usage, authoritative tool
output, committed snapshot, follow-on request digest, and ordinary event
subsequence. A fourth cancellation case must emit one cancelled terminal event,
one speculative discard/cancellation disposition, no uncommitted history, and
no SDK-owned work after shutdown.

### Milestone acceptance

- [ ] The complete public end-to-end flow passes from a clean native checkout.
- [ ] Default-off and single-opt-in paths allocate no speculative runtime
  resources and retain byte-identical model-visible behavior.
- [ ] Typed events make every physical speculative effect and disposition
  visible without confusing it with an authoritative tool invocation.
- [ ] Cancellation, failed response, retry/fallback, fork, resume, and shutdown
  public flows retain the Milestone 5 isolation guarantees.
- [ ] Public docs and migration notes state the complete safety and cost
  contract.
- [ ] Required native, JSONL, binding, crate-boundary, and hosted/WASM checks
  pass.

## Final completion checklist

- [ ] Milestones 0-7 are complete in order with linked retained evidence.
- [ ] `SPEC_PTC_PLAN.md`, this tracker, `PLAN.md`, benchmark documentation, and
  changelogs describe the same shipped scope and limits.
- [ ] The feature is off by default and requires global plus per-registration
  opt-in.
- [ ] No built-in, MCP/dynamic, workspace, shell, image, browser, VM, or
  subagent tool is eligible in the first release.
- [ ] No speculative state enters conversation history, snapshots, rollouts,
  durability, forks, resumes, or hosted/WASM runtimes.
- [ ] Retained evidence proves correctness, isolation, benefit, bounded waste,
  reliability, and resource use.
- [ ] A clean public consumer can reproduce the documented default, miss, hit,
  and cancellation flows.
