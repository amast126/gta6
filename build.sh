#!/usr/bin/env bash
# Builds app.js from src/ with esbuild. Run from the repo root: ./build.sh
# Requires: npm install (react, react-dom, esbuild are in package.json)
set -euo pipefail
cd "$(dirname "$0")"
node scripts/check-content.mjs
npx esbuild src/app.jsx \
  --bundle --minify --format=iife --target=es2019 \
  --loader:.css=text --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=app.js
ls -la app.js
