# Task Plan: Split Lockbox Shim

## Goal
Enable tree-splitting integration tests without building the local C++ lockbox.

## Phases
- [x] Phase 1: Plan the shim approach
- [x] Phase 2: Implement a lightweight lockbox shim
- [x] Phase 3: Add a compose override that uses the shim
- [x] Phase 4: Document the split-test runbook
- [x] Phase 5: Verify syntax and configuration

## Key Questions
1. Can split tests reuse the published lockbox signer for normal keys and signatures?
2. Which lockbox endpoints must be handled locally versus proxied?
3. How should the compose override avoid building the C++ lockbox?

## Decisions Made
- Use a shim/proxy rather than a full signer mock.
- Proxy all existing lockbox endpoints to `mercurylayer/lockbox:latest`.
- Implement only `/split/prepare`, `/split/finalize`, and `/split/abort` in the shim.
- For `/split/prepare`, create child keys by forwarding `/get_public_key` calls to the real lockbox so child signatures still work.
- Do not claim this tests the Spark key-sum invariant; it tests server/client/tree flow and signing gates.
- Add a dedicated Rust harness exposed as `cargo run -- split`.

## Errors Encountered
- None yet.

## Status
**Complete** - Shim, compose override, and runbook are in place; syntax and compose config checks passed.
