# Mercury Layer Server

Mercury Layer Server is a RESTful HTTP service exposing an API for the Mercury Layer Client. 

# Running

1. Run the `lockbox` project (which supports filesystem, Google KMS, or Hashicorp key managers) and set the url in the `enclaves` property in `Setting.toml`.
2. Set the Postgres `connection_string` property in `Setting.toml`.
3. `cargo run`

This is a work in progress. Several changes to the project are expected.
