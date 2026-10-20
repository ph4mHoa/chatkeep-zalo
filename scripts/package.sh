#!/usr/bin/env bash
# Builds the Chrome Web Store upload: dist/chatkeep-zalo-<version>.zip, from extension/.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
out="dist/chatkeep-zalo-$version.zip"
mkdir -p dist
# -FS keeps an existing zip in sync with the folder (files deleted since are dropped too).
(cd extension && zip -q -r -FS "../$out" . -x '.*' '*/.*')
echo "$out ($(du -h "$out" | cut -f1))"
