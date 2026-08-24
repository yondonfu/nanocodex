# Speculative Programmatic Tool Calling

## Status and decision

This is a proposed native Code Mode feature, not a separate project. It belongs
in the existing `nanocodex-oai-api`, `nanocodex-tools`, and `nanocodex-agent`
ownership boundaries and must not add a crate, provider abstraction, generic
scheduler, JavaScript parser framework, or second public/authoritative tool
runtime.

The motivating evidence is Alex Zhang's
[speculative PTC experiment](https://alexzhang13.github.io/blog/2026/spec-ptc/).
Its approximately 1.0-1.2x results justify a measured prototype, not an
assumption that speculation is broadly beneficial.

There are two gates before production implementation:

1. **Feasibility:** retained representative traces must show that eligible tool
   calls commonly become reachable with useful decode time remaining.
2. **Contract:** the repository owner must accept the narrow precommit-effect
   exception described below.

Stop if either gate fails. Do not expose or merge the production builder API,
tool-registration API, event additions, or runtime path until the complete
prototype passes the graduation gates. Baseline and trace-analysis tooling may
land independently because they are useful without changing runtime behavior.

If the feature graduates, it is experimental and disabled by default. A
library caller must opt in both for the agent and for every registered handler
that may run speculatively. Runtime opt-in remains required even if a private
implementation branch uses temporary compile-time controls while measuring the
prototype. Do not ship a Cargo feature as the final user policy.

Do not start this slice ahead of the active order in `PLAN.md`. Begin the
feasibility analysis after the focused Code Mode parity work and the following
Codex checkpoint review have landed, unless the repository owner explicitly
reprioritizes it. Add the implementation slice to `PLAN.md` only after the
feasibility and contract gates pass. Re-review the landed Code Mode boundary at
that point rather than preserving private types named here mechanically.

## Goal

Reduce prompt-to-terminal latency by launching explicitly eligible nested Code
Mode tool calls while the `exec` custom-tool source is still streaming. When
the successfully completed response later runs that exact program in the
authoritative Code Mode cell, an exact matching invocation claims the completed
or in-flight speculative result instead of starting the handler again.

The first slice supports only the program's **synchronous first wave**:

- a tool call may launch when ordinary synchronous JavaScript evaluation has
  reached it from a viable streamed prefix;
- the shadow host never resolves speculative tool promises back into
  JavaScript;
- calls constructed synchronously before an await, including calls collected
  for `Promise.all`, may launch together; and
- no call reachable only after a speculative result, timer, yield, or other
  asynchronous continuation may launch.

For example, both calls below are in the first wave:

```javascript
const first = tools.lookup({ id: 1 });
const second = tools.lookup({ id: 2 });
const values = await Promise.all([first, second]);
```

Only the first call below is in the first wave:

```javascript
const first = await tools.lookup({ id: 1 });
const second = await tools.lookup({ id: first.next });
```

This restriction preserves the primary opportunity to overlap tool latency
with model decode while avoiding hidden result-dependent chains and unstable
call order after asynchronous continuations. The first slice does not perform
static dependency analysis or rewrite sequential programs into parallel ones.

Success means lower end-to-end latency with identical committed history,
model-visible requests, authoritative tool arguments and results, final output,
and ordinary event ordering. Enabled agents additionally expose explicit
speculative lifecycle events after the event-contract graduation described
below. Speculation must never improve benchmark correctness by changing a
task, verifier, prompt, tool result, or retry policy.

## Gate 1: trace feasibility before runtime work

Run the cheap kill-shot analysis before changing transport, Code Mode, or
public APIs. Use representative retained real Code Mode traces and a declared
set of caller-defined tools that a real consumer would consider eligible.
Built-ins, MCP, deferred providers, workspace tools, and hypothetical tools
with no consumer do not count as evidence.

For every `exec` item, derive:

- whether `OutputItemAdded` identifies it before its input deltas;
- the first prefix at which a conservative lexical scan could attempt shadow
  evaluation;
- the first prefix at which an intercept-only QuickJS dry host can synchronously
  observe an eligible call without executing its handler;
- time from that point to `OutputItemDone` and `response.completed`;
- actual eligible-tool latency and theoretically recoverable overlap;
- whether the call is in the synchronous first wave;
- whether the program uses deferred discovery, timers, `Date`, `Math.random`,
  prior-result-dependent calls, duplicate declarations, or a live/yielded cell;
  and
- the number of deltas and candidate evaluations the proposed private limits
  would admit.

Commit a deterministic extractor, a sanitized structural workload, the
selection procedure, and a content-addressed summary containing the relevant
distributions. Keep unredacted traces outside Git. The committed derived data
must be sufficient for a reviewer to reproduce the feasibility calculation
without access to an undocumented private corpus.

Proceed only if all of these are true:

- a representative real consumer and eligible tool set exist;
- at least half of representative `exec` programs that invoke those tools have
  a first-wave candidate before `response.completed`;
- projected prompt-to-terminal p50 improvement for eligible turns is at least
  5% using recorded tool and decode timings; and
- the projected opportunity is not concentrated in a single trace, tool, or
  pathological program shape.

Also report the stricter `OutputItemDone`-to-`response.completed` opportunity.
If waiting for a complete item retains enough benefit, prefer that safer launch
boundary and delete partial-prefix execution from the design. If the corpus is
missing representative eligible tools, treat the result as insufficient
evidence rather than filling the gap with synthetic tools.

## Gate 2: blocking invariant decision

True streaming speculative PTC conflicts with the current runtime invariant:

> Commit only completed responses. A failed partial response must not execute
> a tool or enter history.

A speculative call is a real externally observable operation even when its
result is quarantined. It can reveal intent, consume quota, incur cost, mutate
state, or continue after its Rust future is cancelled. Calling it "read only"
does not remove those effects.

After Gate 1 passes and before production implementation, explicitly approve
and document a narrow replacement invariant with these semantics:

> A failed partial response must not execute an ordinary tool or enter history.
> When the embedding caller enables speculative programmatic tool calling,
> only statically registered handlers separately marked as speculation-safe may
> execute before `response.completed`. Their results remain physical-attempt-
> local and quarantined; they become ordinary tool results only after an exact
> invocation in the successfully completed response claims them.

The opt-in contract must state that the handler:

- may receive an invocation even when the response fails, is incomplete,
  retries, is cancelled, or never contains a matching committed invocation;
- may receive arguments that appear in no invocation of the finalized program
  because partial JavaScript can change meaning through hoisting or later
  declarations;
- may finish after cancellation, consume shared rate limits, and incur charges
  for an abandoned call;
- tolerates duplicate, concurrent, and abandoned invocations without a safety
  or correctness failure;
- permits a result obtained shortly before the committed invocation to satisfy
  that invocation;
- does not rely on exactly-once execution, a stable shared idempotency key, or
  the speculative invocation being the user's final intent; and
- is safe to run in parallel according to the existing
  `supports_parallel_tool_calls()` contract.

This is a semantic contract, not a claim that the SDK can prove safety. The SDK
cancels and drains owned work best-effort, but cancellation of an arbitrary
caller-defined future cannot retract an external request.

The streamed source is uncommitted and unvalidated at launch time. A
caller-installed Tower service can emit it through `ResponsesAttempt::emit`,
and a provider failure or `response.incomplete` can follow it. Exact final-
source validation protects claiming only; it does not make an earlier launch
trusted. Document this threat boundary in the public API.

If this invariant change is not accepted, retain only the trace analysis and
benchmark. A post-completion scheduler may optimize already committed calls,
but it is not streaming speculative PTC and must not be presented as such.

## Scope

The first supported surface is deliberately narrow:

- native `nanocodex-agent` sessions;
- one local QuickJS Code Mode `exec` custom-tool item in a generation response;
- only its synchronous first-wave calls;
- statically registered caller-defined tools explicitly marked eligible; and
- physical generation attempts that expose `OutputItemAdded` followed by
  normalized custom-tool input deltas with usable identity.

A candidate tool must have both independent declarations:

- speculation eligibility on its static `ToolsBuilder` registration; and
- `Tool::supports_parallel_tool_calls() == true`.

Neither declaration implies the other. All existing tools remain ineligible
unless deliberately changed later with their own evidence.

The following remain ineligible in the first slice:

- workspace and shell tools, `apply_patch`, plan updates, and retained process
  operations;
- image generation, built-in web search, browser, VM, and subagent lifecycle
  tools;
- MCP and other dynamic providers, including deferred tool search;
- direct model tool calls outside the Code Mode `exec` program;
- `wait` calls and any new `exec` while another Code Mode cell is live;
- a response containing more than one `exec` item;
- calls reached after a speculative promise, timer, or yield;
- programs that access shadow-blocked nondeterministic or asynchronous globals;
- hosted/WASM Code Mode runtimes;
- durable replay of an already completed model execution; and
- warmup and compaction Responses operations.

A scope rejection is a normal speculation miss and must not change ordinary
execution.

## Prototype and graduated public API

### Private prototype

Implement and benchmark the enabled runtime on a focused branch before merging
public surface. Temporary prototype controls stay crate-private or confined to
the branch. Do not merge a public trait method, builder method, event variant,
or metric field that the failure path intends to delete. This keeps every
merged slice releasable.

The separately mergeable first slice is the trace extractor, scripted service,
delayed tool, report schema, and disabled baseline. It exercises only existing
public API and has value even if speculation is rejected.

### Graduated runtime policy

If the prototype passes every gate, add one default-false native runtime policy
to `NanocodexBuilder` and explicit registration metadata to
`nanocodex-tools`:

```rust
let tools = Tools::builder()
    .without_defaults()
    .speculative_tool(lookup)
    .build()?;

let (agent, events) = Nanocodex::builder(openai)
    .tools(tools)
    .speculative_programmatic_tool_calls(true)
    .build()?;
```

`speculative_tool` registers an ordinary `Tool` plus the speculation-safe bit;
it does not create a second handler trait. Keep this metadata in the
`nanocodex-tools` registry rather than adding an agent execution-policy method
to the dependency-light `Tool` trait in `nanocodex-oai-api`.

The builder method is native-only under the same target-gating convention as
other native builder methods. It is never a silent no-op on hosted/WASM
targets. Cross-target consumers gate the call at compile time.

The agent-level policy is fixed for one owned driver lifecycle. Clean children
and forks created by that recipe inherit it. A resumed session uses the new
builder's policy and tool selection; speculative policy is not serialized in a
snapshot. No speculation ledger, in-flight result, shadow runtime, or private
attempt token enters typed conversation history, checkpoints, rollouts, or
durability state.

Enabling the feature must not change model-visible input:

- no system/developer instruction changes;
- no new model-visible tool definition or schema;
- no tool-order change;
- no request-prefix, prompt-cache-key, or cache fingerprint change; and
- no change to finalized `exec` source or authoritative Code Mode output.

An agent with the policy disabled, or with no eligible registrations, must not
create an attempt observer, shadow QuickJS host, speculation task, or ledger.

### Event and metric compatibility

Speculative calls are real tool activity and cannot remain visible only in
diagnostic traces. Graduation therefore includes an intentional public event-
contract change:

- add typed speculative launch, result, claim, and discard events with a unique
  provisional invocation ID, complete arguments, and complete observed result;
- keep them distinct from ordinary `ToolEvent`, whose call and result remain
  tied to the authoritative program invocation;
- add a typed terminal speculation summary containing launches, claims,
  discards, peak concurrency, physical work time, hidden time, and post-claim
  wait time; and
- expose the successful-turn summary through an additive `TurnResult` accessor.

`AgentEventKind`, `RunMetrics`, and neighbouring public projection structs are
not currently all safely extensible in Rust. Coordinate the new typed variants
and summary with the next deliberate public-contract release: make the affected
types non-exhaustive or introduce a nested non-exhaustive speculation type,
document the migration, and validate JSONL, native, language-binding, and WASM
consumers. Serde defaults alone do not make a Rust struct-field addition
compatible.

Failed and cancelled turns still emit the existing terminal run boundary plus
their speculative summary. Nanocodex reports physical counts and timing but
cannot estimate monetary cost for arbitrary caller-defined tools; the
embedding application owns that valuation.

If the prototype fails, delete its private runtime path before merge. If a
merged public API ever exists, do not use later deletion as an experimental
cleanup strategy; follow the repository's normal versioned public-contract
process.

## Ownership and architecture

### `nanocodex-oai-api`: attempt-aware nonblocking input observation

The OpenAI boundary already normalizes
`response.custom_tool_call_input.delta` as
`ResponseEvent::ToolCallInputDelta`. Extend its existing response observer seam
rather than introducing a callback framework or changing the Tower response
type.

Do not use `ResponsesAttempt::attempt()` as speculative identity. That public
diagnostic counter resets to one during WebSocket-to-HTTPS fallback. Mint an
opaque, process-local, monotonically unique `PhysicalAttemptToken` immediately
before each physical transport send, including fallback sends. The token is
never serialized, exposed to callers, or reused.

Add a small internal envelope carrying:

- the session-monotonic logical model call index;
- the opaque physical attempt token;
- the existing diagnostic attempt number and transport for telemetry only;
- attempt start, replacement, and terminal lifecycle;
- raw provider item ID and raw call ID as separate optional fields;
- whether a normalized identity was synthesized;
- `OutputItemAdded`, input-delta, item-done, and response-terminal data needed
  by speculation; and
- the normalized `ResponseEvent` when one exists.

Do not infer that a delta belongs to `exec`. The agent waits for an
`OutputItemAdded(ResponseItem::CustomToolCall { name: "exec", ... })` binding
for the same raw identity. A call-ID-only item remains explicitly call-ID-only;
never place the same synthesized string into both identity positions. An
unbound, ambiguous, renamed, or identity-changing item is poisoned and cannot
launch or claim speculation.

Observation must never backpressure the provider stream. Use a private bounded
channel with nonblocking delivery. If `try_send` fails, atomically poison that
physical attempt, drop further speculative data, and notify the receiver to
cancel its session without delaying normal transport decode. Attempt lifecycle
invalidation may use a separate atomic/watch signal so queue saturation cannot
strand work. A slow or absent consumer has no effect on the Tower result.

The ordinary public `ResponseEvent` stream remains unchanged. Preserve the
Tower contract: one `Service<ResponsesAttempt>` call still runs through
`response.completed` or a typed failure. `ResponsesClient<S>` remains generic
over the caller's concrete service, and the SDK's retry layer remains the sole
retry owner. A caller-supplied service that emits deltas through
`ResponsesAttempt::emit` participates in the same physical token without
receiving an agent or tool-runtime type.

Tests at this layer must cover ordinary retry, WebSocket-to-HTTPS fallback,
identical bytes and provider IDs across physical attempts, aggregate-only
completion, missing item binding, call-ID-only binding, queue overflow, and a
slow observer. They must prove that transport completion time is unchanged by
observer behavior.

### `nanocodex-tools`: eligibility, state epoch, shadow execution, and claims

`nanocodex-tools` owns a private native `SpeculativeCodeModeSession` associated
with one physical generation attempt and one bound `exec` item. It owns:

- a disposable QuickJS runtime separate from the authoritative Code Mode host;
- an immutable snapshot and epoch of Code Mode's JSON `store` state;
- cumulative streamed source for the bound item;
- a restricted view of the existing heterogeneous registry;
- bounded first-wave candidate evaluations and handler futures; and
- the one-shot result ledger later attached to an authoritative `LiveCell`.

Add a monotonic stored-state epoch. Increment it whenever a completed or failed
cell commits stored writes. A speculation snapshot is available only when the
live-cell registry is empty. At authoritative cell admission, require both that
the live-cell exclusion still holds and that the epoch equals the captured
epoch. Otherwise discard the ledger and execute normally.

Do not add a JavaScript parser dependency. Use a small conservative lexical
scanner that understands strings, template literals, escapes, comments, and
balanced delimiters only well enough to identify a newly closed eligible
`tools.<name>(...)` expression in a lexically balanced source prefix. False
negatives are acceptable. QuickJS remains the syntax and execution authority.

For each accepted prefix, evaluate the complete cumulative source in a fresh
shadow context. The shadow tool bridge:

- launches an eligible first-wave handler and returns a promise that is never
  resolved inside the shadow;
- reuses an existing candidate slot when a longer prefix replays the same
  `(name, canonical input, per-key ordinal)` invocation;
- creates separate slots for separate identical invocations;
- aborts on an ineligible/unknown tool, dynamic provider, `notify`,
  `yield_control`, or other unsupported host effect;
- permits local `text`, `store`, and `load` behavior only inside the disposable
  context and never commits it; and
- replaces `Date`, `Math.random`, timers, and any other exposed nondeterministic
  or asynchronous clock source with a private speculation-abort operation.

Extend the private embedded-host protocol with `FirstWaveSealed`. QuickJS emits
it after the async function's initial synchronous invocation returns its
pending promise, but before draining later microtasks or delivering any tool
result back to JavaScript. Every `RuntimeEvent::ToolCall` observed before that
marker belongs to the first wave; every call observed after it is ineligible
for speculation. The authoritative host uses the same marker, so first-wave
membership never depends on Rust future completion order or on how quickly a
claimed result is ready.

Because promises never resolve in the shadow, speculative tool results cannot
affect control flow or launch a second wave. A syntax error, incomplete
program, abort, unsupported operation, stale epoch, or exhausted budget is a
speculation miss, never a turn failure.

Use concrete conservative private limits for the first prototype:

- 64 KiB maximum speculative source per item;
- eight shadow evaluations per item and logical model call;
- eight physical speculative handler launches across the entire logical model
  call, including all physical retries and fallback transports;
- four speculative handlers in flight concurrently;
- one shadow evaluator and one shadow QuickJS worker per active model call;
- 25 ms wall/CPU deadline per shadow evaluation;
- 16 MiB QuickJS heap limit and 1 MiB stack limit for the shadow runtime; and
- no timer scheduling or continuation after a speculative promise.

A newly closed eligible call may trigger an evaluation immediately; otherwise
require at least 32 new source bytes since the prior evaluation. Never exceed
the evaluation cap merely to find a syntactically valid prefix. Record the
limits before collecting candidate results. They may be adjusted once from the
disabled baseline if the committed report explains why; do not tune them after
seeing the enabled result.

When a newer useful prefix arrives, interrupt the obsolete shadow evaluation
without cancelling already launched handler futures. The next evaluation may
reuse the same candidate slots. If interruption or deadline enforcement cannot
stop QuickJS promptly, poison the session and terminate its worker; do not
spawn an unbounded sequence of replacement threads.

The authoritative cell remains the only owner of program semantics and stored
state. It asks the sealed ledger for an exact claim immediately before it would
execute an eligible nested handler. A completed candidate returns its stored
`ToolOutput`; an in-flight candidate is awaited; a miss follows the existing
normal execution path.

### `nanocodex-agent`: lifecycle and integration

The private driver owns the speculation lifecycle because it already owns the
model attempt, turn cancellation, retry outcome, tool runtime, and shutdown.
For an enabled generation call with eligible registrations it:

1. asks `nanocodex-tools` for a stored-state snapshot and epoch; absence of live
   cells is a precondition;
2. creates a logical-call budget shared across all physical attempts;
3. polls the complete Tower call while consuming its nonblocking attempt-aware
   observation stream;
4. cancels and invalidates the old physical session when a new opaque attempt
   token starts, without resetting the logical-call launch budget;
5. binds at most one item to `exec` through `OutputItemAdded`, appends its
   initial input and deltas, and feeds only admitted prefixes to
   `nanocodex-tools`;
6. poisons the opportunity if a second `exec` item, ambiguous identity,
   overflow, unsupported lifecycle, or missing fragment is observed;
7. on `response.completed`, verifies the successful physical token, raw item
   identity, stored-state epoch, and exact finalized `exec` source before
   sealing a ledger;
8. appends only the completed response to authoritative history as today; and
9. hands the sealed ledger to the corresponding authoritative Code Mode cell.

The ledger becomes cell-owned at step 9. It survives a yielded `exec` and later
`wait` observations, with occurrence state scoped to that cell. It drains when
all candidates are claimed or unreachable, the cell reaches a terminal state,
the owning turn is cancelled, or the runtime shuts down. Do not cancel all
leftovers merely because the first `exec` observation yielded back to the
model.

A model failure, incomplete response, malformed completion, retry replacement,
turn cancellation, steer that abandons the current run, driver shutdown, or
tool-runtime shutdown invalidates the affected unsealed session and cancels
owned tasks. Shutdown holds normal Code Mode admission closed while
speculative and ordinary Code Mode work drain. Retained shell behavior remains
unchanged because shell tools are never eligible.

An execution-policy replay of a completed model step has no live delta stream,
so it executes Code Mode normally. Speculation remains an ephemeral latency
optimization and never changes durable step semantics.

## Matching and correctness

Never claim by tool name and arguments alone. Identify a candidate with:

- logical model call index;
- opaque physical attempt token;
- bound raw `exec` item ID and call ID, preserving which fields actually exist;
- canonical registry tool name;
- canonical JSON input; and
- ordinal among identical `(tool name, canonical input)` first-wave invocations
  in the bound item.

Canonicalize object keys recursively before encoding the match key. Preserve
JSON types and array order. Separate identical calls get separate ordinals and
separate physical results. Re-evaluating a longer prefix may reuse only the
same ordinal slot; it must not merge separate identical calls. This reconciles
prefix replay reuse with the prohibition on collapsing nondeterministic calls.

Before sealing a ledger, require the initial input from `OutputItemAdded` plus
the concatenated deltas to equal the finalized source on the completed
`CodeCall`. Require exactly one matching `exec` item and the same raw identity.
If the provider omitted a fragment, changed identity, produced another `exec`,
or returned different final source, discard the session. Never reuse a result
across a physical attempt, model call, turn, fork, resume, or agent.

During authoritative execution, assign ordinals from tool events received
before the authoritative `FirstWaveSealed` marker and claim only an exact
unclaimed key. Calls after that marker receive no candidate. A completed
candidate returns its stored `ToolOutput`; an in-flight candidate is awaited;
a missing, cancelled, already-claimed, stale-epoch, or mismatched candidate
executes normally. A tool error or panic converted to the existing
`ToolOutput` error is a valid result only for its exact candidate.

The speculative `ToolContext` uses the same model, session, committed history,
and output budget that are knowable at launch. Its `call_id` is a unique
provisional ID derived from the opaque attempt token and candidate slot. It is
not promised to equal any later authoritative nested-call ID and must never
collide with one. The public contract explicitly does not offer a shared
idempotency key between an abandoned speculation and a later ordinary call.

The existing Code Mode observer remains authoritative for ordinary nested-tool
events. Emit its normal call and result when the completed program reaches the
invocation, in program order, even when the result is claimed. The separate
speculative events describe the earlier physical execution. Filtering those
new events from an enabled run must leave the ordinary event subsequence
identical to the disabled run.

## Observability and security record

Speculative physical activity must be present in full-fidelity tracing even
before a public event contract graduates. Add bounded root-relative spans or
events for:

- session creation and opaque physical attempt identity;
- each candidate's complete tool name and input;
- provisional `ToolContext` identity;
- launch, completion, cancellation, discard, and claim;
- complete observed result for every finished candidate;
- launch-to-claim overlap, post-claim wait, work duration, and outcome;
- source mismatch, stale epoch, observer overflow, and private-budget misses;
  and
- handler errors, including rate-limit/429 classifications when available.

Keep complete source, arguments, and results in ordered span events, with
identity, sizes, timing, status, and counts as attributes. Do not redact,
filter, truncate, or omit values already observed by the lifecycle. "Bounded"
means the span represents one finite attempt or candidate; it does not permit
payload truncation. Bound what the shadow is allowed to execute and observe
beforehand. Documentation must warn operators that traces contain uncommitted
model source and abandoned tool inputs/results and require conversation-grade
access and retention controls.

A speculative branch is a sibling of model-call work under the bounded turn
root. Link the later authoritative claim structurally rather than manufacturing
a second physical execution span. Keep ordinary `tool_calls` and
`tool_work_duration_ns` semantically stable; speculative physical work belongs
in the separate speculation summary and must be neither hidden nor
double-counted.

The implementation never retries a speculative handler on its own. Record
shared-quota contention, rate-limit failures, and ordinary-handler failures so
the benchmark can detect when speculation makes the enabled path slower or
less reliable.

## Benchmark

Add `spec-ptc-bench` as a standalone binary in `nanocodex-examples`, following
the pattern in `docs/RESPONSE_TRANSPORT_BENCH.md`. It is a direct consumer of
the real Nanocodex lifecycle, not a second runtime. Write raw reports under
`.nanocodex/benchmarks/` and keep them outside Git. Commit the executable,
deterministic workload definitions, report schema, extractor, run
documentation, and a dated summary of accepted or rejected results.

The baseline example may merge before runtime work. The enabled variant is
evaluated on the implementation branch using the proposed final API shape; it
merges with that API only after all gates pass.

### Layer 0: retained-trace feasibility

Run Gate 1. This is the first and cheapest decisive benchmark. Record both the
partial-prefix opportunity and the safer complete-item opportunity.

### Layer 1: disabled, miss-path, and local overhead

Use Criterion only to isolate local costs:

- current baseline versus the compiled runtime policy left disabled;
- enabled agent with no eligible registrations;
- enabled and eligible source with no viable prefix;
- viable prefix with no launched call;
- calls launched but all discarded;
- token-level malformed prefixes up to the evaluation cap;
- valid prefixes at representative source sizes;
- canonicalization and ledger hit/miss/double-claim paths; and
- shadow host startup, deadline, memory-limit, and forced-interrupt paths.

This layer detects overhead, amplification, and allocation regressions but
cannot establish end-to-end benefit.

### Layer 2: deterministic full-agent replay

The primary causal benchmark uses a scripted concrete
`Service<ResponsesAttempt>` and the real Nanocodex driver. It emits exact item
bindings and input deltas at recorded times, returns the exact finalized
`exec`, observes the real Code Mode result in the follow-on request, and then
returns a deterministic final message. A caller-defined eligible lookup tool
returns exact JSON after a configured fixed or jittered delay and independently
records every physical start, completion, argument, provisional call ID,
error, and cancellation.

For every workload run paired disabled/enabled variants with byte-identical:

- model-visible request prefix and tool definitions;
- prompt history and prompt-cache key;
- provider item IDs, call IDs, delta bytes, boundaries, and timing;
- finalized model response and follow-on response;
- tool outputs and configured latency schedule; and
- retry, fallback, cancellation, and failure schedule.

Rotate pair order. Predeclare sample sizing from the disabled variance before
collecting the enabled result. Use paired bootstrap confidence intervals for
latency deltas; collect enough pairs to estimate p95 rather than treating a
handful of samples as a tail measurement. Verify every follow-on serialized
request digest, not only final text.

The matrix includes:

| Dimension | Values |
| --- | --- |
| Eligible calls | 1, 2, 4, 8 |
| Tool latency | 50 ms, 250 ms, 1 s; fixed and jittered/adversarial completion order |
| Decode remaining after first launch | 0 ms, 250 ms, 1 s |
| Program shape | one call, sequential awaits, first-wave `Promise.all`, loop, dependent chain |
| JavaScript semantics | duplicate function/`var` hoisting, conditional, `Date.now`, `Math.random`, timer |
| Matching | unique, duplicate input, reordered object keys, source/identity/ordinal mismatch |
| Eligibility | all eligible, mixed, parallel-unsafe, none, deferred provider |
| Code Mode state | no cell, live/yielded cell, prior cell commits store during decode, stale epoch |
| Lifecycle | success, failed/incomplete response, ordinary retry, transport fallback, cancel, shutdown |
| Stream quality | complete deltas, missing fragment, ambiguous/call-only ID, malformed source, no deltas, overflow |
| Outcome | all claims, partial claims, zero claims without launches, zero claims after launches |
| Quota | success, rate-limit error, transient tool error, shared-concurrency contention |

Replay timing and chunk shapes from the committed sanitized derived workload.
The report includes the source corpus hash, extractor version, selection rules,
and structural histograms so the decisive claim is auditable. Unredacted raw
traces remain outside Git and are not the only definition of the gate workload.

Record at least:

- prompt acceptance to terminal p50 and p95 with paired confidence intervals;
- first event, item done, completed model response, authoritative Code Mode
  start/completion, and follow-on model completion;
- theoretical available overlap and observed recovered overlap;
- evaluations, launches, claims, misses, discards, and peak concurrency;
- physical handler executions per committed nested invocation;
- useful, hidden, post-claim wait, cancelled, and abandoned tool milliseconds;
- observer overflows, deadline/memory aborts, and shadow-worker replacements;
- handler and rate-limit error rates;
- process CPU, peak RSS, and shadow-host startup cost;
- model usage and exact serialized request bytes; and
- final output, committed snapshot, request digest, ordinary and speculative
  event order, and terminal status.

Define call amplification as total physical handler executions divided by
committed nested invocations only for successful representative cases with a
nonzero denominator. Define recovered overlap for a claimed call as handler
time elapsed before authoritative invocation, capped at total handler duration.
Forced failure, retry, cancellation, and shutdown cases report absolute
abandoned calls and work rather than being folded into the representative
discard percentage.

Freeze and publish the exact weighting of the representative successful
workload and the separate lifecycle-stress workload before collecting enabled
results. Report latency saved, extra work, and errors; speedup alone is
insufficient.

### Layer 3: live supporting evidence

After deterministic correctness and performance gates pass, deploy the exact
focused source to `ubuntu@dev-georgios`. Run alternating enabled/disabled pairs
against the supported live model with the same cache identity and model-visible
configuration. Use caller-defined deterministic delayed tools so the verifier
can prove exact calls and outputs. Record full JSONL and traces, provider usage,
tool/rate-limit errors, failures, and raw timing outside Git.

Live latency is supporting, non-binding evidence because model output and
service latency vary. It must not be described as a causal gate. Any correctness
divergence, isolation failure, or material increase in tool/rate-limit failure
rate is still a blocker. Report the paired live confidence interval without the
unfalsifiable requirement that it merely "support the direction."

## Graduation gates

Record thresholds, workload weights, and statistical methods before collecting
the candidate result. Graduate only when all gates pass:

1. **Feasibility:** Gate 1 passes with a reproducible committed derived corpus.
2. **Contract:** the precommit-effect invariant and public safety wording are
   explicitly accepted.
3. **Correctness:** zero divergence in final output, committed snapshot,
   follow-on request digest, model usage, authoritative nested-tool
   arguments/results, and ordinary event subsequence across the deterministic
   matrix.
4. **Isolation:** exactly one claim per committed invocation; no claim across a
   physical token, item, model call, cell, turn, fork, resume, or agent.
5. **Disabled cost:** disabled agents create no observer, shadow host, task, or
   ledger and show no statistically meaningful latency or allocation
   regression. Enabled agents with no eligible registrations remain within 1%
   of disabled p50 and p95.
6. **Eligible miss cost:** enabled eligible cases with zero claims stay within
   the larger of 2% or 25 ms at p50 and p95, remain within the frozen CPU/RSS
   budget, and never exceed evaluation or launch limits. Launched-all-discard
   cases also satisfy their absolute call/work caps.
7. **Causal benefit:** eligible deterministic cases recover at least 80% of the
   overlap available after the first admitted prefix.
8. **Representative benefit:** the lower bound of the paired 95% confidence
   interval shows at least 5% prompt-to-terminal p50 improvement. The upper
   bound for p95 regression is no worse than the larger of 2% or 25 ms.
9. **Representative waste:** successful representative call amplification is
   at most 1.05 and discarded calls are at most 5% of speculative launches.
   Forced lifecycle cases are evaluated separately with absolute bounds.
10. **Reliability:** the enabled path has no material increase in handler,
    rate-limit, transport, or terminal failure rate and performs no speculative
    retry of its own.
11. **Resource cost:** shadow CPU and peak RSS are recorded and accepted;
    neither grows without the declared source, evaluation, launch, and
    concurrency bounds.
12. **Lifecycle:** cancellation, incomplete responses, retry/fallback, yielded
    cells, stale state, overflow, and shutdown leave no claimable ledger or
    owned task outside the defined cell/runtime lifecycle.

If correctness, isolation, or security fails, stop and fix the highest owning
boundary before more performance work. If representative improvement is 1-4%,
or any final benefit/waste/reliability gate fails, do not ship the feature.
Delete the private prototype runtime and retain the reproducible benchmark and
dated negative result.

## Implementation sequence

### 1. Measure feasibility and freeze the benchmark

- Add the retained-trace extractor, sanitized derived workload, scripted
  service, delayed tool, report schema, and disabled baseline.
- Measure first-wave reachability and both partial-prefix and complete-item
  overlap.
- Classify the actual candidate tools for a real consumer.
- Freeze workload weights, private limits, statistical method, and thresholds.
- Stop if Gate 1 fails.

Exit when the committed data can reproduce the projected opportunity and the
baseline verifies exact request, history, and event semantics.

### 2. Accept the contract and release shape

- Resolve the blocking runtime-invariant decision.
- Choose partial-prefix or complete-item launch from Gate 1 evidence.
- Re-review the landed Code Mode implementation and update this plan for real
  ownership changes.
- Define the eventual builder, static registration, speculative event, terminal
  summary, and native-target compatibility contract.
- Plan the required public event/projection version change; do not expose it
  yet.
- Add the scheduled slice to `PLAN.md` only now.

Exit when there is no ambiguity about precommit effects, provisional context,
public observability, compatibility, cancellation, or deletion on failure.

### 3. Add the attempt-aware OpenAI seam

- Mint opaque tokens for every physical send, including transport fallback.
- Add the private raw-identity/lifecycle envelope and nonblocking attachment.
- Bind items without conflating item ID and call ID.
- Poison on overflow without delaying transport.
- Keep public `ResponseEvent`, generic Tower composition, retry ownership, and
  complete-call semantics unchanged.
- Add focused tests for success, aggregate-only response, retry, fallback,
  failure/incomplete response, identity ambiguity, and slow/overflowing
  consumers.

Exit when the private consumer distinguishes every physical send and bound
`exec` item without observing socket internals or affecting normal completion.

### 4. Build the bounded tools-owned shadow runtime

- Add static registration metadata without changing the `Tool` trait.
- Add live-cell exclusion and stored-state epochs.
- Add the conservative prefix scanner and first-wave-only shadow bootstrap.
- Add the shared `FirstWaveSealed` embedded-host boundary and prove it is
  independent of handler completion order.
- Enforce source, evaluation, launch, concurrency, wall/CPU, heap, stack, and
  timer limits.
- Add canonical per-key ordinal slots and one-shot claim-or-execute integration.
- Attach sealed ledgers to `LiveCell` so they survive yields correctly.
- Add focused tests for all syntax, semantics, matching, state, limits,
  cancellation, errors, and panic cases in the required inventory.

Exit when authoritative output and stored state are byte-identical for every
hit/miss case and no unclaimed result can escape its physical/cell lifecycle.

### 5. Complete the private agent vertical slice

- Thread the private default-off policy through root, clean child, fork, and
  resume construction.
- Poll model completion and observation together without changing the Tower
  call boundary.
- Share launch budget across retries, bind one `exec`, seal only on exact
  completed identity/source/state, and transfer ownership to the cell.
- Wire failure/incomplete response, retry/fallback, steering, cancellation,
  yield/wait, shutdown, and drain behavior.
- Add full tracing and private benchmark counters.
- Exercise the branch's proposed final API shape from `spec-ptc-bench`.

Exit when disabled behavior is byte-identical, the complete lifecycle matrix
passes, and the example requires no transport or runtime internals.

### 6. Benchmark and decide

- Format the focused branch and use cheap consumer typechecks while iterating.
- Build the coherent slice once for `dev-georgios`, run deterministic trials,
  then retained-workload and paired live evidence.
- Inspect exact JSONL, traces, request bytes, handler logs, rate-limit failures,
  and resource use.
- Apply the predeclared confidence intervals and every graduation gate.
- Commit the reproducible workload, raw-report hashes, run instructions, dated
  summary, and explicit ship/delete decision; keep raw traces outside Git.

If any final gate fails, remove the private runtime path before merge.

### 7. Graduate the public feature

- Add the default-false native `NanocodexBuilder` policy and explicit
  `ToolsBuilder::speculative_tool` registration.
- Land the release-coordinated typed speculative events, terminal summary, and
  `TurnResult` accessor with migration notes.
- Document precommit effects, provisional call IDs, trace retention, quota/cost
  risk, cancellation, native target gating, and eligible-tool requirements.
- Use the benchmark example as the real public-API consumer.
- Run the smallest relevant warnings-denied Clippy, focused tests, public
  example checks, crate-boundary check, JSONL/language-binding consumers, and
  unchanged hosted/WASM builds at final handoff.

Merge only as a complete releasable vertical slice with the retained benchmark
evidence attached.

## Required test inventory

The final focused test set must cover:

- default-off construction and zero disabled-path resources;
- enabled construction with zero eligible registrations;
- eligible source with zero evaluations, zero launches, and launched-all-
  discarded outcomes;
- `OutputItemAdded` binding before deltas, call-ID-only identity, ambiguous
  identity, missing binding, and more than one `exec` item;
- complete streamed source and aggregate-only responses;
- failed and incomplete responses after a speculative launch;
- ordinary retry and WebSocket-to-HTTPS fallback with identical item IDs,
  source, tool name, and arguments;
- observer overflow and a slow/dropped consumer without transport delay;
- turn cancellation before launch, during a handler, and after completion but
  before claim;
- driver and tool-runtime shutdown with in-flight work;
- fork, clean child, snapshot, resume, and durable model-step replay isolation;
- no live cell, yielded cell, a prior cell committing store during decode,
  stale state epoch, and ledger retention across `wait`;
- mixed eligible/ineligible programs, parallel-unsafe tools, deferred tools,
  and unsupported host effects;
- first-wave sequential call, first-wave `Promise.all`, dependent second wave,
  loop, duplicate, and conditional calls;
- identical first-wave classification under fixed, jittered, immediately ready,
  and adversarial handler completion order;
- duplicate function/`var` hoisting divergence;
- `Date`, `Math.random`, timer, `notify`, and `yield_control` aborts;
- canonical JSON object ordering without array or type conflation;
- source/item/call/token/ordinal mismatch and double-claim rejection;
- source, evaluation, logical-call launch, concurrency, deadline, heap, and
  stack limits;
- tool success, structured error, panic conversion, rate-limit error, late
  completion, and cancellation that cannot retract an external request;
- provisional `ToolContext` identity and no collision with authoritative call
  IDs;
- unchanged ordinary nested-tool event subsequence and committed history;
- complete speculative event and terminal-summary projection after graduation;
  and
- native success plus unchanged hosted/WASM compilation when the feature is
  unavailable.

Do not add prompt-text assertions for scheduling policy. Exercise the real
scripted service, agent lifecycle, QuickJS host, registry, typed events, and
retained derived workload.
