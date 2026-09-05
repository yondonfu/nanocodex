# Rejected tool replay acceptance

## Local validation

- `cargo test -p nanocodex-oai-api -p nanocodex-agent --offline`: 345 passed; one existing ignored test.
- `cargo clippy -p nanocodex-oai-api -p nanocodex-agent --all-targets --offline -- -D warnings`: passed.
- `pnpm --filter nanocodex-vite run build:wasm`: passed, rebuilding the shared Rust runtime into managed Worker WASM.
- Managed Worker typecheck and Vitest: 129 tests passed across 21 files.
- `pnpm --filter nanocodex-managed-service exec wrangler deploy --dry-run --env="" --config wrangler.jsonc --outdir dist --containers-rollout=none`: passed. The default dry run required a running Docker daemon; container rollout was disabled because the sandbox image is unchanged.

The new regression exercises actual WebSocket request serialization, a schema rejection, failed-turn checkpoint persistence, shutdown, durable rollout reload, full replay, and discovery of the corrected schema. It runs for both an incremental request and a physical full replay after checkpoint eviction. Pure boundary tests cover HTTP and WebSocket envelopes, namespace children, unrelated error codes/paths, exact definition matching, valid siblings, completed function results, and search item identities.

## Production baseline

Original SMA/Nanocodex agent: `00462eb1-11f4-8b78-a33a-e796f3b3cdd7`. Its enabled configuration and history are preserved. The UI confirms that temporary validation agent `9c494abb-69f8-8311-b1c3-e61113d299b3` was deleted.

Before deployment, run `f482883b-def9-4f00-8089-13bb8cc8357e` failed with `invalid_function_parameters` at `input[7].tools[3].parameters`, missing `before_message_id` for `commons_get_conversation`. Four mention inputs remained pending: 7577, 7641, 7643, and 7650.

## Production recovery (2026-09-05 UTC)

Deployed with `pnpm deploy:managed --containers-rollout=none`, preserving the existing sandbox image. Previous Worker version: `3a633da6-d6a5-4b5d-88d8-454dde0d08db`. New Worker version: `c09d94a1-567a-45ce-aa89-c11f4373a969`, built from commit `b4890cfb`.

1. Manual run `e879f42f-2bdd-493a-bc79-26e7b3c0c9d8` failed once with the same schema error, now classified as `rejected_tool_definition`, and performed no tools. This saved the repaired checkpoint.
2. Follow-on manual run `23089f86-76e3-4def-9f4b-e135e67334e7` completed and recorded idle after checking eligible work. Its outbound full replay retained search output `tso_01a06f32-084b-7962-a957-c3fe5f5a4121` / call `call_uBRJ23Nsd5utJJ3ZqFcvWfF1`, with all seven valid sibling definitions and only `commons_get_conversation` removed. No history reset or agent replacement was used.
3. Automatic webhook recovery run `00bb61da-18ae-4cb4-802a-c755874bdba5` completed with four hosted calls. It posted `7 + 8 = 15.` for mention 7577 (message 1957) and `9 + 6 = 15.` for mention 7641 (message 1958), both with applied reply receipts. It resolved mentions 7643 and 7650 as handled because their correct replies already existed.
4. A fresh browser page confirmed all four mentions resolved, the personal subscription active/verified, and no reconciliation error. The original agent remains enabled with its empty task allowlist, no cron, and limits 15 minutes / 32 tools / 96 runs per day.

This verifies recovery of the previously poisoned production session across subsequent turns, including an automatic mention turn and actual thread replies. The fresh-catalog rediscovery path is additionally covered by the durable protocol regressions; the production mention turn could use valid sibling tools retained from its original discovery.

## Limits

Repair is deliberately driven by the provider's structured schema rejection and exact physical request. Errors without a usable tool-search parameter path remain unchanged. Configured top-level tools are not removed. The rejected turn still fails; its repaired checkpoint unblocks the next turn. Already poisoned histories need one rejection under the new runtime before a subsequent turn can proceed. Fixing an invalid live tool catalog remains the tool host's responsibility.
