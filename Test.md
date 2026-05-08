# Running Rust tests

1. `$ docker compose -f docker-compose-token-servers.yml up --build` to run the Mercury and token servers. This also starts a Esplora node.

2. Run the commands below to start the Bitcoin network.

```bash
$ container_id=$(docker ps -qf "name=esplora-container")
$ wallet_name="esplora_wallet"
$ docker exec $container_id cli createwallet $wallet_name
$ address=$(docker exec $container_id cli getnewaddress $wallet_name)
$ docker exec $container_id cli generatetoaddress 101 "$address"
```

3. `cd clients/tests/rust/` 

4. `cargo run`

# Running Rust split tests without building lockbox

Use the split shim override when testing statechain tree splitting on a machine where building the local C++ lockbox is too expensive. The shim sits at `lockbox:18080`, proxies normal lockbox signing routes to the published `mercurylayer/lockbox:latest` image, and handles only the split lifecycle routes.

```bash
$ docker compose \
  -f docker-compose-token-servers.yml \
  -f docker-compose-split-shim.yml \
  up --build
```

Then initialize the regtest chain:

```bash
$ container_id=$(docker ps -qf "name=esplora-container")
$ wallet_name="esplora_wallet"
$ docker exec $container_id cli createwallet $wallet_name || true
$ address=$(docker exec $container_id cli getnewaddress)
$ docker exec $container_id cli generatetoaddress 101 "$address"
```

Run the existing Rust regression tests:

```bash
$ cd clients/tests/rust/
$ rm -f wallet.db wallet.db-shm wallet.db-wal
$ ML_NETWORK=regtest cargo run
```

Run the split harness:

```bash
$ cd clients/tests/rust/
$ ML_NETWORK=regtest cargo run -- split
```

The split harness creates a 1500 sat parent coin, splits it into 1000 and 400 sat children with a 100 sat branch fee, signs the branch transaction, signs each child backup transaction, finalizes the split, fetches tree metadata, transfers the first child, and withdraws the second child. This shim validates the Mercury server/client tree flow, status guards, branch signing, child backup signing, finalize/abort handling, and tree metadata. It does not validate the real lockbox key-sum invariant or parent key tombstoning; those still require the real split-enabled C++ lockbox.

# Running Web tests

1. `$ docker compose -f docker-compose-token-servers.yml up --build` to run the Mercury and token servers. This also starts a Esplora node.

2. `$ docker compose -f docker-compose-token-lnd-nodes.yml up --build` to start LND nodes to test lightning latch functions.

3. Run the commands below to start the Bitcoin network.

```bash
$ container_id=$(docker ps -qf "name=esplora-container")
$ wallet_name="esplora_wallet"
$ docker exec $container_id cli createwallet $wallet_name
$ address=$(docker exec $container_id cli getnewaddress $wallet_name)
$ docker exec $container_id cli generatetoaddress 101 "$address"
```

4. Run the commands below to start and set up the LND nodes.

```bash
$ container_id=$(docker ps -qf "name=mercurylayer-bitcoind-1")
$ wallet_name="new_wallet"
$ docker exec $container_id bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass createwallet $wallet_name
$ address=$(docker exec $container_id bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass getnewaddress $wallet_name)
$ docker exec $container_id bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass generatetoaddress 101 "$address"
$ container_id_alice=$(docker ps -qf "name=mercurylayer-alice-1")
$ container_id_bob=$(docker ps -qf "name=mercurylayer-bob-1")
$ identity_pubkey_bob=$(docker exec $container_id_bob lncli -n regtest getinfo | jq -r '.identity_pubkey')
$ docker exec $container_id_alice lncli -n regtest connect $identity_pubkey_bob@bob:9735
$ address=$(docker exec $container_id_bob lncli -n regtest newaddress p2wkh | jq -r '.address')
$ container_id_bitcoind=$(docker ps -qf "name=mercurylayer-bitcoind-1")
$ docker exec $container_id_bitcoind bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass sendtoaddress $address 0.5
$ docker exec $(docker ps -qf "name=mercurylayer-bitcoind-1") bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass -generate 6
$ identity_pubkey_alice=$(docker exec $container_id_alice lncli -n regtest getinfo | jq -r '.identity_pubkey')
$ docker exec $container_id_bob lncli -n regtest openchannel $identity_pubkey_alice 100000
$ docker exec $(docker ps -qf "name=mercurylayer-bitcoind-1") bitcoin-cli -regtest -rpcuser=user -rpcpassword=pass -generate 5
```


5. Install the nodejs components and run the tests:

```bash
$ cd clients/libs/web
$ npm i
$ cd ../../tests/web
$ npm i
$ npm install chai
$ node server-regtest.cjs # start the test server
$ npx vitest --browser.name=chromium --browser.headless --reporter=basic --disable-console-intercept
```

# Other Environments

The `docker compose -f docker-compose-token-servers.yml` file can be used to build a Mercury Layer infrastructure in test or production environments as it has all the necessary servers including Lockbox, Electrs/Esplora, Token, and Mercury.
The default values ​​of this file however must be changed.
