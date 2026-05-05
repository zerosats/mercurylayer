{
  description = "Rust Development Shell";

  inputs = {
    nixpkgs.url      = "github:NixOS/nixpkgs/nixos-25.11";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url  = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };
      in
      with pkgs;
      {
        devShells.default = mkShell {
          buildInputs = [
            openssl
            llvmPackages_latest.clang
            llvmPackages_latest.bintools
            gcc13
            go
            protobuf
            bitcoind

            cmake

            pkg-config
            (
              rust-bin.fromRustupToolchainFile ./rust-toolchain.toml
            )

            # Pre-built RocksDB to avoid compiling librocksdb-sys from source (~30 min)
            rocksdb
          ];
          RUST_SRC_PATH = pkgs.rustPlatform.rustLibSrc;
          LIBCLANG_PATH = pkgs.lib.makeLibraryPath [ pkgs.llvmPackages_latest.libclang.lib ];
          PROTOC = "${pkgs.protobuf}/bin/protoc";
          ROCKSDB_LIB_DIR="${pkgs.rocksdb}/lib";
          ROCKSDB_INCLUDE_DIR="${pkgs.rocksdb}/include";
        };
      }
    );
}
