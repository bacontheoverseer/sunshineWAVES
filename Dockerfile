# --- Stage 1: Build Environment ---
FROM rust:1.88-slim AS builder

WORKDIR /app

# Install build dependencies commonly required by Rust crates (e.g., OpenSSL, C compiler)
RUN apt-get update && apt-get install -y cargo rustc
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt-get/lists/*

# Copy project files
COPY . .

# Limit parallel compilation jobs to lower sandbox memory footprint
ENV CARGO_BUILD_JOBS=2

# Build release binary inside the mochi directory
WORKDIR /app/mochi
RUN cargo build --release --jobs 2

# --- Stage 2: Lightweight Runtime Environment ---
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt-get/lists/*

# Copy built binary from the builder stage
COPY --from=builder /app/mochi/target/release/mochi /usr/local/bin/mochi

# Set default execution command
CMD ["mochi"]