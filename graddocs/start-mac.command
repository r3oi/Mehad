#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then open this file again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close"
  exit 1
fi
node serve.mjs 5173 --open
