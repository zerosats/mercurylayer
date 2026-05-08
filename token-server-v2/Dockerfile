# First stage: builder
FROM debian:bullseye-slim as builder
RUN apt-get update && apt-get install -y curl build-essential protobuf-compiler libprotobuf-dev pkg-config libssl-dev
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /mercurylayer
COPY ./docker/Cargo.token-server-v2.toml ./Cargo.toml
COPY ./Cargo.lock ./Cargo.lock
COPY ./token-server-v2 ./token-server-v2
COPY ./token-server-v2/Rocket.toml ./token-server-v2/Rocket.toml
WORKDIR /mercurylayer/token-server-v2
RUN CARGO_TARGET_DIR=target cargo build --release

# Second stage: final image
FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y ca-certificates
WORKDIR /app
# Copy the built binary from builder stage
COPY --from=builder /mercurylayer/token-server-v2/target/release/token-server-v2 .
COPY --from=builder /mercurylayer/token-server-v2/Rocket.toml .
EXPOSE 8001
CMD ["./token-server-v2"]
