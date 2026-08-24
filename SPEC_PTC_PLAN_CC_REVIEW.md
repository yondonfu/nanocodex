# Adversarial review: `SPEC_PTC_PLAN.md`

Reviewed against the code as of `f2cb55c5` (branch `master`). Every claim below
is cross-checked against a specific location in the tree; evidence is given as
`file:line`.

Findings are ordered by severity. The summary judgement is at the end.

## Blockers — the matching and isolation scheme does not hold

### 1. Attempt identity is not unique: `attempt` resets to 1 on transport fallback

The plan keys candidates on `(logical model call index, physical response
attempt)` and gates "no claim across a physical retry" on that tuple.

`prepare_transport_fallback` sets `self.attempt = 1`
(`crates/nanocodex-oai-api/src/tower/attempt.rs:391`), and the WebSocket to
HTTPS fallback path calls it while emitting `next_attempt: 1`
(`crates/nanocodex-oai-api/src/tower/middleware/retry.rs:122,143`). Attempt 1
therefore occurs twice within one `call_index`.

The second defense fails on the same case: retries set `full_replay = true` and
resend identical input, so the model can legitimately emit a byte-identical
program, and the "streamed deltas must equal the finalized source" guard passes.

**Fix.** Identify attempts with a process-local monotonic token minted per Tower
call, never the retry counter. The test inventory entry "retry with identical
item IDs, source, tool name, and arguments" passes vacuously unless it
specifically covers the transport-fallback path.

### 2. Occurrence-index matching is unstable under concurrency, and the benchmark is built to hide it

The plan matches on "dynamic invocation occurrence within that `exec`
execution". In the real runtime that number is the host-assigned `id`
(`nested_call_id = format!("{}/code-{id}", context.call_id)`,
`crates/nanocodex-tools/src/code_mode/mod.rs:1148`), incremented in the order
JavaScript calls `nativeTool`.

For `Promise.all([a(), b()])` that order is deterministic. For calls issued from
independent async continuations it depends on the resolution order of prior
awaits, and the shadow run resolves differently from the authoritative run *by
construction*: the shadow's tool results arrive earlier because they are real
and already in flight, while the authoritative run either claims instantly or
re-executes. Occurrence indices skew, keys miss, and the second of the two
stated wins ("precompute multiple calls already issued concurrently by a
streamed program") is the case most likely to fail.

Layer 2 cannot detect this. It uses a configured fixed delay per tool, so shadow
and authoritative timings line up and occurrence order matches. Detecting it
requires jittered handler latency and a program whose call order depends on
await resolution.

There is a real tension the document does not name: strict occurrence matching
is unstable under concurrency, and loose (name plus canonical input, multiset
claim) matching is exactly what the plan forbids for nondeterministic tools.
Pick one deliberately and record the cost.

### 3. Prefix execution is not program execution, so speculative calls can carry arguments that never exist

The source is compiled as an `AsyncFunction` body
(`crates/nanocodex-tools/src/code_mode/bootstrap.js`, `new AsyncFunction(...)`).
Hoisting makes a later duplicate `function` declaration win at hoist time in the
full program but not in the prefix:

```js
function cfg() { return { id: 1 } }
await tools.lookup(cfg())        // prefix -> {id:1}; full program -> {id:2}
function cfg() { return { id: 2 } }
```

`var` hoisting and `typeof` guards produce the same class of divergence.

This is not a claim-safety bug — the key mismatches and the claim misses — but it
is an externally visible call carrying arguments the model never committed to.
The opt-in contract lists duplicate, concurrent, and abandoned invocations but
not this. Add: *may be invoked with arguments that appear in no committed
invocation.*

### 4. Nondeterministic argument construction silently zeroes the hit rate and burns the launch budget

Nothing in the bootstrap removes `Date.now()`, `new Date()`, or `Math.random()`.
The plan re-evaluates the whole cumulative prefix on every useful extension and
reuses launched futures by key. A program building
`{ requested_at: Date.now(), ... }` produces a different canonical key on every
replay: a new physical launch each time, up to the 8-launch cap, after which the
committed run's key matches none of them. Zero claims, eight wasted external
calls, amplification near 8x.

Every workload in the Layer 2 matrix is deterministic, so gate 6 (amplification
at most 1.05) passes while production sits at 8.

**Fix.** Either freeze or stub nondeterministic globals in the shadow — which
changes semantics and must be stated — or add a "nondeterministic argument
construction" row to the matrix and to the amplification denominator.

### 5. Speculation bypasses the nested parallel-safety lock

Code Mode serializes non-parallel-safe tools behind a write guard on a per-cell
`RwLock` (`crates/nanocodex-tools/src/code_mode/mod.rs:1117,1155-1181`). A
speculative launch has no cell and no guard, so a tool whose
`supports_parallel_tool_calls()` is `false` gets run concurrently with other
nested calls, with other speculative launches (the plan allows four), and — on a
miss — concurrently with its own authoritative execution.

The plan correctly says "do not infer eligibility from
`supports_parallel_tool_calls`" but never states the converse.

**Fix.** Either require `supports_parallel_tool_calls() == true` as a *necessary*
(not sufficient) precondition for eligibility, or route speculative launches
through the same exclusion lock.

### 6. Yielded cells and `wait` are entirely unmodeled

`exec` cells yield and are resumed by a separate `wait` tool
(`crates/nanocodex-tools/src/code_mode/spec.rs:33`). Three consequences the plan
does not cover:

- The ledger must outlive the model call, because the authoritative cell can
  span many model calls. Step 7 of the agent lifecycle says the driver "cancels
  and drains all leftovers" immediately after handing the ledger over.
- A previously yielded cell commits its `store` writes at *its* terminal
  (`crates/nanocodex-tools/src/code_mode/mod.rs:1324,1328`), and the
  authoritative snapshot is taken at *cell* start (`mod.rs:399`), not at
  model-call start as the plan specifies. The shadow snapshot is provably not
  the authoritative one whenever a prior cell finishes during decode.
- Occurrence numbering has to be scoped to the cell across yields.

### 7. The delta stream does not identify which tool an item belongs to

`ResponseEvent::ToolCallInputDelta` carries only `item_id` and an optional
`call_id` (`crates/nanocodex-oai-api/src/responses/event.rs:180-188`) — no tool
name. `ApplyPatch` is also a custom tool
(`crates/nanocodex-tools/src/standard.rs:51`), so its input deltas arrive on the
same event.

Worse, normalization falls back to `item_id.or(call_id)`
(`crates/nanocodex-oai-api/src/responses/event.rs:184`), so the "response item
ID" can in fact *be* a call ID, and the plan's `(item_id, call_id)` tuple can
alias.

**Fix.** State that an item is not speculated on until `OutputItemAdded` binds it
to `exec`, and define behavior when identity was synthesized from `call_id`.

## Security

### 8. Speculation creates an execution path invisible in the conversation and the public event stream

Speculative calls return real results, so a prefix can branch on real data and
issue further eligible calls: a bounded chain (eight) of real external effects
that never enters history, never emits a `ToolEvent`, and is recorded only in
traces.

`response.incomplete` is grouped with `Failed`
(`crates/nanocodex-oai-api/src/tower/stream.rs:536`), so a content-filtered or
truncated response has still executed its tools. The completed-response gate is
doing more work than "do not commit garbage": it is the only point at which a
response is validated before it has effects, and this proposal removes it for
the streamed path.

Two mitigations worth taking in slice 1:

- Restrict eligibility to calls whose arguments do **not** depend on a prior
  speculative tool result. That alone delivers the stated goal (overlap decode)
  and removes the chain entirely.
- Surface abandoned speculative calls somewhere the user can see, not only in
  traces.

### 9. The streamed bytes become a code-execution trigger from an untrusted path

`ResponsesAttempt::emit` is public
(`crates/nanocodex-oai-api/src/tower/attempt.rs:348`) and any caller-installed
Tower service can emit arbitrary deltas. The source-equality check gates
*claiming*, not *launching*. A buggy middleware, a mock, or a compromised stream
gains tool execution with attacker-chosen arguments that surfaces nowhere.

State this in the threat model, and state explicitly that the launch decision is
made on unvalidated bytes by design.

### 10. The shadow runtime has no analogue of the yield safety valve, and no evaluation bound

The authoritative cell's protection against a runaway program is the yield
mechanism: it hands control back to the model. The shadow has no consumer to
yield to.

There is no memory limit and no CPU deadline anywhere in the host (no
`set_memory_limit` or deadline in
`crates/nanocodex-tools/src/code_mode/embedded.rs`). The only lever is the
interrupt flag (`embedded.rs:92-106,155,186`), which is host-level, so
terminating an obsolete evaluation likely means killing the thread and
`Runtime` and spawning a fresh one — per prefix extension. "Reuse the existing
Code Mode input and runtime limits where they exist" is carrying a great deal of
weight for limits that largely do not exist.

Meanwhile the plan bounds *launches* (eight) but not *evaluations*, and the
central throttle — "on a useful source extension" — is undefined. With
token-level deltas that is potentially hundreds of full re-executions of the
program's local compute, on unvalidated model output, each possibly costing a
thread and a QuickJS runtime.

**Fix.** Define the extension trigger concretely (statement-boundary heuristic,
minimum bytes, minimum interval), bound evaluations per attempt, and set a
wall-clock and memory cap on shadow evaluation.

### 11. Trace payload policy contradicts itself and persists the only copy of uncommitted data

"Each candidate's complete tool name and input" and "complete observed result
for a finished candidate" sit against "bounded root-relative spans". For
abandoned candidates the trace is the only record of data that never entered
history — exactly the case a user would not expect to be persisted. Reconcile
with the existing tool-payload redaction policy and set explicit size caps.

## API breakage and iteration

### 12. `Tool` lives in the wrong crate for this method

`pub trait Tool` is defined in `crates/nanocodex-oai-api/src/tools/mod.rs:469`,
not in `nanocodex-tools`. The plan places "add the per-tool default-false
eligibility method" under the `nanocodex-tools` work item (Implementation step
3). As written, an agent-runtime *execution policy* concept lands in the
protocol crate — the same crate whose own section insists the seam "must not
receive an agent or tool-runtime type".

**Fix.** Put it on a separate extension trait owned by `nanocodex-tools`.

### 13. The failure branch is a semver-major change on stable crates

The plan's honest exit is to "delete the production builder API and runtime
path". Removing a public trait method and public metric fields breaks
downstream consumers, which collides with "leave `master` releasable"
(`PLAN.md`, Delivery model). A separate opt-in trait — deletable without
touching `Tool` — or a Cargo-feature-gated surface makes the delete branch
actually executable.

### 14. `RunMetrics` is not `#[non_exhaustive]`

`crates/nanocodex-oai-api/src/events/data.rs:197`. Every neighbouring type in
that file is `#[non_exhaustive]` (lines 17, 59, 95, 112, 168, 269, 304, 337,
439); `RunMetrics` is not. Adding six public fields breaks struct-literal
construction and exhaustive patterns, and removing them later breaks again.
Serde defaults solve the JSON compatibility problem, not the Rust one.

**Fix.** Mark it `#[non_exhaustive]` first, or nest the speculation counters in
their own `#[non_exhaustive]` flattened sub-struct.

### 15. `bool` eligibility is a one-way door

The second real request will be "eligible only under a cost cap" or "eligible
for these argument shapes". Return a `#[non_exhaustive]` policy struct from day
one.

### 16. Naming

`supports_speculative_tool_calls` parses as "this tool supports calling tools
speculatively" — the wrong subject — and reads as a sibling of
`supports_parallel_tool_calls`, which describes a different axis. Prefer
`may_execute_speculatively` or `speculation_safe`.

### 17. `ToolContext::call_id` under speculation is undefined, and it is exactly the key duplicate tolerance needs

`ToolContext` carries `call_id`, documented as "the provider tool-call identity"
(`crates/nanocodex-oai-api/src/tools/mod.rs:318,354`). The plan requires
handlers to tolerate duplicates but supplies no stable idempotency key: if the
speculative and claimed invocations receive different `call_id`s, a correctly
written idempotent tool double-executes.

The authoritative identity is derivable (`{parent_call_id}/code-{id}`,
`crates/nanocodex-tools/src/code_mode/mod.rs:1148`) but only when the provider
supplied `call_id` in the deltas. Decide and document this explicitly. It is the
difference between "tolerates duplicates" being achievable and being a wish.

### 18. The builder method's behavior on WASM is unspecified

`#[cfg]`-ing it out breaks cross-target callers at compile time; keeping it as a
silent no-op is a lying API. Pick one: present on all targets, with a typed
error at `build()` on unsupported targets.

### 19. Observer channel backpressure is unspecified

If the shadow consumer is slow and the queue is bounded, backpressuring the
transport slows the model stream, which is the exact opposite of the feature's
purpose. State the rule: never backpressure the transport; drop and poison the
item. The planned "slow observer" test needs a required behavior to assert.

## UX

### 20. Cancellation stops meaning what users think it means

In the CLI, pressing Escape during streaming currently guarantees that nothing
happened. With this enabled, an external call may already be in flight and
billed. The blast radius is small — shell and workspace tools are ineligible —
but the mental-model change needs an explicit user-facing story, not only a
documentation paragraph on the builder method.

### 21. Abandoned calls cost the caller money that appears nowhere the user looks

`estimated_cost` and `cost_usd` cover provider tokens only. Surface
abandoned-call counts next to usage, not only in `RunMetrics`.

### 22. Speculation competes with itself for the caller's rate limit

A missed speculative call still holds a connection and quota slot against the
same backend the authoritative call is about to hit; 429s make the enabled path
slower. Nothing in the plan or the gates observes this. Add a rate-limit and
error-rate observation to gate 6, and mention shared quota contention in the
opt-in contract.

## Benchmark and gates

### 23. No gate covers the common production case: enabled, eligible tools, zero claims

Gate 3 covers only "enabled with no eligible tools", which allocates nothing.
The miss path — shadow host spawned, prefix re-evaluated N times, calls launched
and discarded — is what most real turns will do, and nothing bounds its
regression.

### 24. Amplification and discard denominators are undefined

Gate 6 requires "representative call amplification at most 1.05" and "discards
at most 5% of speculative launches", but the Lifecycle matrix rows (failed
partial response, retry, cancel, shutdown) are 100% discard by construction.
Without a defined mix and an assumed real-world failure rate, that gate is where
a bad result gets rationalized. Record the mix alongside the thresholds, per the
plan's own "record thresholds before collecting" rule.

### 25. The decisive number is not reproducible

The retained-trace replay is what gate 5 actually turns on, and its corpus is
deliberately kept outside Git. Commit the derived workload *and* a structural
summary sufficient for a reviewer to re-derive the claim, or the gate is
unauditable.

Relatedly, "live paired runs must support, rather than contradict, that
direction" is unfalsifiable. Give it a numeric criterion or label it explicitly
non-binding.

### 26. Gate 5's thresholds are likely noise-dominated

A 2% p95 tolerance on end-to-end agent turns is below typical run-to-run
variance; the plan needs a stated repetition count and statistical test, not
"enough repetitions". Note also that the cited evidence's low end (1.0x) sits
below the 5% p50 bar, so the expected outcome is deletion. That is honest, but
the plan should say what happens at 1-4%.

### 27. Run the cheap kill-shot experiment before implementing anything

Step 1 already captures "representative real delta timing and program-shape
summaries". Extend it to answer the single question that decides the feature:

> In retained real traces, what fraction of `exec` programs contain an eligible
> call reachable in a syntactically valid prefix before `response.completed`?

Deferred tool discovery is a designed-in first move for many programs, and any
deferred-search call aborts speculation, so that fraction could be near zero.
One day of work answers it, instead of four implementation slices.

### 28. Missing matrix dimensions

- nondeterministic argument construction;
- `setTimeout` or sleep inside the prefix (an `await sleep(5000)` stalls the
  single serialized shadow evaluation for the rest of the attempt; the plan has
  no policy on virtualizing shadow timers, and both choices are wrong in
  different ways);
- a yielded cell completing during decode;
- transport fallback;
- shadow-versus-authoritative scheduling skew, via jittered handler latency;
- prefix-hoisting divergence.

## Smaller items

- The plan forbids memoizing two identical invocations within one program but
  *requires* reusing launched futures across prefix replays. These are
  reconcilable — the same occurrence is the same logical invocation — but the
  document should say so, because a reviewer implementing "retain already
  launched eligible futures" alongside "nondeterministic tools must never
  collapse into one memoized result" will read them as contradictory.
- This work does not appear in `PLAN.md`'s "Current execution order". Given the
  spec opens by ordering itself after items 5 and 6, add it as a numbered entry
  or it will float.

## Summary judgement

The plan is unusually disciplined about the *ethics* of the invariant change and
unusually weak about the *mechanics* of matching.

Findings 1, 2, 5, and 6 are each sufficient to make a working implementation
silently incorrect or silently useless, and none of them are visible in the
benchmark as currently specified.

Recommended order of operations: fix the attempt-identity scheme (finding 1),
resolve the occurrence-matching tension (finding 2), and run the trace
measurement in finding 27 — before writing any of slices 2 through 4.
