# Notes: Split Lockbox Shim

## Existing Lockbox Routes
- `POST /get_public_key`: creates and stores a server key for a statechain id.
- `POST /get_public_nonce`: creates a server nonce for signing.
- `POST /get_partial_signature`: signs using the stored key and nonce.
- `GET /signature_count/<statechain_id>`: returns signature count.
- `POST /keyupdate`: updates server key during transfer receive.
- `DELETE /delete_statechain/<statechain_id>`: deletes lockbox key state.
- `POST /split/prepare`: new split route that local C++ lockbox would normally implement.
- `POST /split/finalize`: new split route that tombstones parent and activates children.
- `POST /split/abort`: new split route that removes pending children.

## Shim Strategy
- Keep the server configured to call `http://lockbox:18080`.
- Replace the `lockbox` service with a Node shim listening on `18080`.
- Add `lockbox-real` using `mercurylayer/lockbox:latest` on internal port `18081`.
- Forward normal lockbox routes from shim to `lockbox-real`.
- Implement split routes locally:
  - `split/prepare`: call `lockbox-real/get_public_key` for each child statechain id and return those pubkeys.
  - `split/finalize`: return `{ "finalized": true }`.
  - `split/abort`: best-effort delete child keys through `lockbox-real/delete_statechain/<id>`, then return `{ "aborted": true }`.

## Limitations
- Parent key material is not tombstoned in the real lockbox after split finalize.
- Server status guards still block parent signing through Mercury, so this is sufficient for server/client integration tests.
- The Spark equality `parent_user + parent_se == sum(child_user_i + child_se_i)` is not tested by this shim.
- Shim state is in memory; restarting it loses split idempotency/cache.
