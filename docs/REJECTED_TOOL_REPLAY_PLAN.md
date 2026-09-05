# Rejected tool replay recovery

## Problem and acceptance criteria

A provider rejection of a discovered function schema currently leaves that schema in durable tool-search history. Correcting the live tool catalog cannot unblock the next turn because full replay resends the rejected definition.

- Recognize `invalid_function_parameters` only when its structured parameter path identifies a function in a tool-search output of the exact failed physical request.
- Remove matching rejected definitions from retained discovery metadata, preserving messages, completed tool results, search call/output identities, and unrelated or corrected definitions.
- Report the original failure without automatically repeating tools or hiding the error. Commit repaired history and force full replay on the next turn.
- Cover incremental requests, full replay after transport recovery, HTTP/WebSocket error envelopes, unrelated failures, and durable restore followed by rediscovery.

## Components and interfaces

1. Transport: resolve provider parameter indices against the actual physical attempt before retry machinery changes the request. Carry the rejected definition as typed failure metadata; never infer it from error prose.
2. Context: remove exact matching definitions only from tool-search output metadata. The managed session invalidates continuation state and records a history replacement.
3. Agent: apply the repair at the failed-turn checkpoint boundary, reusing normal durable history persistence.
4. Validation: focused protocol tests and Rust checks; build the managed WASM boundary and exercise the affected service journey where available.

## Scope

No schema rewriting, automatic retries of failed turns, transcript reset, tool re-execution, or deployment configuration changes. Existing poisoned histories recover after their next schema rejection creates a repaired checkpoint.
