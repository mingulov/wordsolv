#!/usr/bin/env bash
# Downloads the build-time embedding. Not shipped; only its extracted vectors are.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p raw
URL="https://rusvectores.org/static/models/rusvectores4/araneum/araneum_upos_skipgram_300_2_2018.vec.gz"
echo "downloading araneum (192 MB) ..."
curl -fSL -o raw/araneum.vec.gz "$URL"
shasum -a 256 raw/araneum.vec.gz | tee raw/checksums.txt
