#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
OUT_DIR="$ROOT_DIR/frontend/public/wasm"

mkdir -p "$OUT_DIR"

cd "$BACKEND_DIR"
cargo build -p goldminer-core --release --target wasm32-unknown-unknown --features wasm

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "wasm-bindgen CLI is required to finalize browser bindings." >&2
  echo "Install it with: cargo install wasm-bindgen-cli" >&2
  exit 1
fi

wasm-bindgen \
  --target web \
  --no-typescript \
  --out-dir "$OUT_DIR" \
  "$BACKEND_DIR/target/wasm32-unknown-unknown/release/goldminer_core.wasm"
