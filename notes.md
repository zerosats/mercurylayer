# Notes: Local Testing and PWA Statecoin Transfer

## Repo Map
- Root Rust workspace: `clients/apps/rust`, `clients/libs/rust`, `server`, `lib`, `clients/tests/rust`, `token-server-v2`.
- Browser client stack: `clients/libs/web` imports `mercury-wasm` from `wasm/web_pkg/debug`; `clients/tests/web` uses that web lib in Vitest/browser tests.
- WASM source: `wasm/src/lib.rs`, package name `mercury-wasm`, built by `wasm-pack`; checked-in debug/release packages exist under `wasm/web_pkg`.
- Existing top-level `web` app is a basic CRA app and does not appear wired to Mercury transfer logic.

## Local Testing
- `docker-compose-token-servers.yml` is the most browser-compatible regtest stack: Esplora HTTP on `8094`, Mercury server on `8000`, token server on `8001`, lockbox on `18080`, Vault, Postgres DBs.
- `clients/tests/web/server-regtest.cjs` exposes local helper endpoints on `3000` to deposit regtest BTC, generate blocks, and handle optional LND helpers by shelling into Docker containers.
- `clients/tests/web/ClientConfig.js` points web tests at `http://0.0.0.0:8094/regtest` and `http://0.0.0.0:8000` on regtest.
- `clients/tests/web/test/tb01-simple-transfer.test.js` performs wallet1 -> wallet2 statecoin transfer and then withdraws.
- `clients/tests/rust/src/tb01_simple_transfer.rs` performs the same canonical flow against `clients/tests/rust/regtest.Settings.toml`.
- Disk: current filesystem reports 40 GiB available; repo is only 57 MiB. Docker images/volumes are the main space risk.
- Docker Compose is available (`v5.1.1`) and Node is available (`v25.6.0`).
- `clients/tests/web/node_modules` and `clients/libs/web/node_modules` are not installed yet.
- Sandbox note: `rustc --version` attempted to let rustup write under `~/.rustup` and failed under sandbox permissions.

## Statecoin Transfer Flow
- Browser API flow from `clients/libs/web/main.js`: `createWallet`, `newToken`, `getDepositBitcoinAddress`, `listStatecoins`, `newTransferAddress`, `transferSend`, `transferReceive`, `withdrawCoin`.
- Deposit endpoints: `/deposit/get_token`, `/deposit/init/pod`, `/sign/first`, `/sign/second`.
- Sender endpoints: `/transfer/sender` obtains `x1`; `/transfer/update_msg` stores encrypted transfer message for recipient auth key.
- Receiver endpoints: `/transfer/get_msg_addr/{new_auth_key}`, `/info/statechain/{statechain_id}`, `/transfer/unlock`, `/transfer/receiver`.
- WASM provides crypto/validation primitives: transfer signature creation, transfer address decoding, encrypted transfer msg generation/decryption, receiver payload generation, key update, signature scheme validation, outpoint helpers.
- Wallet/backup state in web lib currently lives in `localStorage` under `mercury-layer:*`.

## PWA Client Plan
- Best base: create a new Vite PWA app that consumes `mercuryweblib` from `clients/libs/web`, then migrate/improve storage and UX around the existing tested flow.
- Core screens: config/status, create/import wallet, deposit/token, statecoins list, new receive address, send transfer, receive/poll transfers, withdraw/backup.
- For local tests, include a dev-only regtest faucet/miner panel backed by `server-regtest.cjs`; do not ship those helpers in production.
- PWA storage should likely move from raw `localStorage` to IndexedDB plus optional passphrase/WebCrypto encryption before any realistic deployment.
- Browser CORS must be allowed by local Mercury/Esplora services; current Esplora compose sets `CORS_ALLOW=*`.

## Disk Space
- 40-45 GB is enough for regtest development if Docker Desktop already exists and images are pruned. It may get tight if pulling/building all images plus Rust/npm caches from scratch.
- Prefer starting with `docker-compose-token-servers.yml` rather than the heavier `docker-compose-test.yml` with LND nodes unless testing Lightning latch.
