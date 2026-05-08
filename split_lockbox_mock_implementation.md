# Split Lockbox Shim Runbook

This runbook describes how to test statechain tree splitting without building the local C++ lockbox.

## What This Tests
- Mercury server split endpoints.
- Server split status transitions.
- Branch signing and child backup signing through normal server routes.
- Tree metadata endpoint.
- Client-side split flow once the split test harness is wired.

## What This Does Not Test
- Real lockbox split-key arithmetic.
- Parent key tombstoning inside the real lockbox.
- Durable split idempotency across shim restarts.

## Run

Start the regtest stack with the shim override:

```bash
docker compose \
  -f docker-compose-token-servers.yml \
  -f docker-compose-split-shim.yml \
  up --build
```

Prime the regtest chain:

```bash
container_id=$(docker ps -qf "name=esplora-container")
docker exec "$container_id" cli createwallet esplora_wallet || true
address=$(docker exec "$container_id" cli getnewaddress)
docker exec "$container_id" cli generatetoaddress 101 "$address"
```

Run the existing Rust integration tests:

```bash
cd clients/tests/rust
rm -f wallet.db wallet.db-shm wallet.db-wal
ML_NETWORK=regtest cargo run
```

Run the split harness:

```bash
cd clients/tests/rust
ML_NETWORK=regtest cargo run -- split
```

The harness creates a 1500 sat parent coin, splits it into 1000 and 400 sat children with a 100 sat branch fee, signs the branch transaction, signs each child backup transaction, finalizes the split, fetches tree metadata, transfers one child, and withdraws the other child.
