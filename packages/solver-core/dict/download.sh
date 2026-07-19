#!/usr/bin/env bash
# Vendors raw word-list sources. Run from packages/solver-core/dict/.
set -euo pipefail
mkdir -p raw
curl -fsSL -o raw/enable1.txt "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
curl -fsSL -o raw/en_50k.txt "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"
curl -fsSL -o raw/ru_50k.txt "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt"
curl -fsSL -o raw/russian_nouns.txt "https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt"
sha256sum raw/*.txt > raw/checksums.txt
wc -l raw/*.txt
