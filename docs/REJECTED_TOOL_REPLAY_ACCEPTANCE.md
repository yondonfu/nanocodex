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

Deployment and post-deployment recovery evidence will be recorded after verification.

## Limits

Repair is deliberately driven by the provider's structured schema rejection and exact physical request. Errors without a usable tool-search parameter path remain unchanged. Configured top-level tools are not removed. The rejected turn still fails; its repaired checkpoint unblocks the next turn. Already poisoned histories need one rejection under the new runtime before a subsequent turn can proceed. Fixing an invalid live tool catalog remains the tool host's responsibility.
