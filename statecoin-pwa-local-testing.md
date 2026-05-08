# Local Testing and PWA Statecoin Transfer Plan

## Current Architecture

Mercury Layer is already split in the way a PWA needs:

- Server side: `server`, `token-server-v2`, `lockbox`, Postgres, and Bitcoin indexer services.
- Shared Rust protocol library: `lib`.
- Browser crypto/protocol package: `wasm`, published locally as `wasm/web_pkg/debug` and `wasm/web_pkg/release`.
- Browser client wrapper: `clients/libs/web`, package name `mercuryweblib`.
- Existing browser E2E tests: `clients/tests/web`.

The top-level `web` directory is a generic CRA shell and is not the right base for transfer work.

## Recommended Local Stack

Use `docker-compose-token-servers.yml` for the PWA path:

- `esplora`: regtest explorer API at `http://localhost:8094/regtest`, Electrum at `50001`.
- `mercury-server`: API at `http://localhost:8000`.
- `token-server-v2`: token API behind Mercury on `8001`.
- `lockbox`: signer/key manager on `18080`.
- `db_server` and `db_lockbox`: Postgres databases.
- `vault` and `vault-init`: deterministic local lockbox seed source.

For browser tests and local demo funding, also run `clients/tests/web/server-regtest.cjs` on port `3000`. It shells into the `esplora-container` Docker container to send regtest BTC and generate blocks.

## Existing Transfer Flow to Reuse

The reference browser test is `clients/tests/web/test/tb01-simple-transfer.test.js`.

Flow:

1. Clear local wallets from `localStorage`.
2. Create sender and receiver wallets with `mercuryweblib.createWallet`.
3. Request token with `mercuryweblib.newToken`.
4. Create deposit address with `mercuryweblib.getDepositBitcoinAddress`.
5. Fund deposit with regtest helper `/deposit_amount`.
6. Poll `mercuryweblib.listStatecoins` until the coin reaches `CONFIRMED`.
7. Create receiver transfer address with `mercuryweblib.newTransferAddress`.
8. Send with `mercuryweblib.transferSend`.
9. Receive with `mercuryweblib.transferReceive`.
10. Optional withdraw with `mercuryweblib.withdrawCoin`.

## Browser/PWA Implementation Shape

Create a new Vite PWA app, for example `clients/apps/pwa`, and depend on:

```json
{
  "dependencies": {
    "mercuryweblib": "file:../../libs/web",
    "@vite-pwa/plugin": "latest"
  }
}
```

Core app modules:

- `config`: regtest/signet/mainnet endpoint profiles.
- `walletStore`: wraps current `mercury-layer:*` storage, then migrates to IndexedDB.
- `transferService`: thin async wrapper over `mercuryweblib` calls.
- `regtestService`: dev-only calls to `http://localhost:3000` for funding and block generation.
- `screens`: wallet setup, deposit, statecoin list, receive address, send transfer, receive transfers, withdraw.

Minimum PWA transfer demo:

- Two-wallet local demo mode matching TB01.
- Single-wallet production mode: import/create wallet, show receive address, send to a pasted statecoin address, poll for incoming transfers.
- Service worker only for static app shell. Do not queue protocol mutations offline; transfer send/receive needs live server and chain state.

## Storage and Security Changes Before Real Use

The current web library stores wallet data and backup transactions directly in `localStorage`. For a PWA, replace or wrap this with:

- IndexedDB for wallet state and backup transactions.
- WebCrypto encryption using a user passphrase-derived key.
- Explicit export/backup for mnemonic and backup transactions.
- No regtest helper endpoints in production builds.

## Disk Space Assessment

The workspace is about 57 MiB, and the filesystem currently reports about 40 GiB free. That should be enough for this local regtest path if Docker is already installed and old images/volumes are managed. It may be tight if building/pulling every Docker image, Rust toolchain component, and npm dependency from scratch.

Docker Compose is installed (`v5.1.1`) and Node is installed (`v25.6.0`). The web project dependencies are not installed yet.

Space-saving choices:

- Start with `docker-compose-token-servers.yml`, not `docker-compose-test.yml`, unless Lightning latch tests are required.
- Avoid the LND `alice`/`bob` stack for simple statecoin transfer.
- Prune unused Docker images before large rebuilds.

## First Commands to Try

```bash
docker compose -f docker-compose-token-servers.yml up --build
```

In a second terminal:

```bash
cd clients/tests/web
npm install
node server-regtest.cjs
```

In a third terminal:

```bash
cd clients/tests/web
npm run test:headless -- test/tb01-simple-transfer.test.js
```

If Rust tests are desired:

```bash
cd clients/tests/rust
ML_NETWORK=regtest cargo run
```

## Main Risks

- Rust toolchain is pinned to `nightly`, and sandboxed rustup writes were blocked during inspection.
- WASM README says the package works only with clang 14, so rebuilding WASM may require local toolchain cleanup.
- `clients/libs/web/main.js` imports `decodeInvoice` from `clients/tests/web/test-utils.js`; that test dependency should be removed or isolated before making a production PWA package.
- `ClientConfig.js` uses `0.0.0.0` URLs; browsers should generally use `localhost` or `127.0.0.1` for the PWA config.
- Current localStorage storage is not suitable for production custody UX.
