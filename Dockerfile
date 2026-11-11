# --- Stage 1: Build Environment ---
FROM rust:1.88-slim AS builder

WORKDIR /app

# Install build dependencies commonly required by Rust crates (e.g., OpenSSL, C compiler)
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy only mochi files
COPY mochi/ ./mochi/

# Limit parallel compilation jobs to 1 to prevent Raspberry Pi memory exhaustion
ENV CARGO_BUILD_JOBS=1

# Build release binary inside the mochi directory
WORKDIR /app/mochi
RUN cargo build --release --jobs 1

# --- Stage 2: Lightweight Runtime Environment ---
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy built binary from the builder stage
COPY --from=builder /app/mochi/target/release/mochi /usr/local/bin/mochi

# Set default execution command
CMD ["mochi"]
