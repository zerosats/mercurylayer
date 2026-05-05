set -e

# Build and run hardware mode with lockbox (filesystem key manager)
docker compose -f docker-compose-hw.yml up --build
