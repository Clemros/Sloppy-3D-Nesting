#!/usr/bin/env bash
# Starts the 3D Nesting web app and opens it in the default browser.
#
# Usage:
#   ./start.sh            development server with live reload (port 5173)
#   ./start.sh --prod     production build, served locally (port 4173)
#   ./start.sh --host     also reachable from other devices on the network
#   ./start.sh --no-open  do not open a browser window
#
# Options can be combined, e.g. ./start.sh --prod --host

set -euo pipefail
cd "$(dirname "$0")"

mode=dev
extra=(--open)
for arg in "$@"; do
  case "$arg" in
    --prod) mode=prod ;;
    --host) extra+=(--host) ;;
    --no-open) extra=("${extra[@]/--open}") ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see ./start.sh --help)" >&2; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org" >&2
  exit 1
fi
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 20 ]; then
  echo "Node.js $(node -v) is too old; version 20 or newer is required." >&2
  exit 1
fi

# Install dependencies on first run or when package.json has changed.
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "Installing dependencies..."
  npm install
  touch node_modules
fi

# Drop empty entries left by --no-open.
args=()
for a in "${extra[@]}"; do [ -n "$a" ] && args+=("$a"); done

if [ "$mode" = prod ]; then
  echo "Building..."
  npx vite build
  echo "Serving production build (Ctrl+C to stop)"
  exec npx vite preview "${args[@]}"
else
  echo "Starting development server (Ctrl+C to stop)"
  exec npx vite "${args[@]}"
fi
