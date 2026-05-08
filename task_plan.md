# Task Plan: Local Testing and PWA Statecoin Transfer

## Goal
Review the Mercury Layer codebase and produce a practical setup path for local testing plus a PWA client that can execute a statecoin transfer.

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Map repo structure and local test entrypoints
- [x] Phase 3: Trace statecoin transfer APIs and browser/WASM support
- [x] Phase 4: Produce setup and implementation plan

## Key Questions
1. What local services are needed for a complete regtest transfer?
2. Which existing client library is the best base for a PWA?
3. What storage, networking, and wallet state constraints matter in a browser?
4. Is 45 GB disk space enough for local test dependencies and containers?

## Decisions Made
- Use existing test harnesses and docs as source of truth before proposing a new PWA shape.
- Use `clients/libs/web` and `wasm/web_pkg` as the PWA foundation rather than the top-level CRA `web` app.
- Use `docker-compose-token-servers.yml` plus `clients/tests/web/server-regtest.cjs` for browser-compatible local regtest statecoin transfer testing.

## Errors Encountered
- `clients/tests/web/README.md` was absent, so package scripts and test files were used instead.
- `rustc --version` was blocked by sandboxed rustup writes to `~/.rustup`; running Rust commands may need approval if rustup/cache writes are required.

## Status
**Complete** - setup and implementation plan written to `statecoin-pwa-local-testing.md`.
