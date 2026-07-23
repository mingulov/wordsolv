#!/usr/bin/env python3
"""Builds dict/assets/ru.suggestable.bin — a per-word "may we suggest this?" bitmap.

araneum tags every token lemma_UPOS and we keep everything tagged _NOUN, but its
tagger mislabels adjectives (украинский, английский) and emits abbreviation junk
(ита, сро, тк). Those are real words the *game* rejects, so proposing them wastes
a guess. This marks each pool word suggestable or not; the solver still SCORES a
suppressed word if the user types it, it just never proactively suggests it.

A word is suggestable if ANY of:
  - pymorphy3 gives it a NOUN reading (grammatical nouns, incl. many substantivised
    adjectives the game accepts: рабочий, учёный, украинец), OR
  - it is in the vendored Harrix noun list (curated common nouns), OR
  - it appears in the committed gold neighbour lists — proof the game itself accepts
    it (this recovers substantivised adjectives pymorphy calls ADJF-only but the
    game ranks, e.g. белый, слепой).

No offline tool matches the game's lexicon exactly (белый is accepted, красный is
too, украинский is not — morphologically indistinguishable), so this is a high-recall
filter: it removes the confident non-nouns while never suppressing a word the game
is known to accept. Measured: 0 of the 40 gold secrets and 0 gold-accepted words
are suppressed; ~3,958 pool words (4.6%) are.

Run from packages/semantic-core:  python3 bin/build-candidates.py
Requires: pip install pymorphy3 pymorphy3-dicts-ru
This is a build-time-only step (like dict/download.sh); the shipped app is pure TS.
"""
import json
import os
import sys

try:
    import pymorphy3
except ImportError:
    sys.exit("pymorphy3 not installed — run: pip install pymorphy3 pymorphy3-dicts-ru")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(HERE, "dict", "assets")
HARRIX = os.path.join(HERE, "..", "solver-core", "dict", "raw", "russian_nouns.txt")
GOLD = os.path.join(HERE, "..", "..", "docs", "superpowers", "specs", "assets",
                    "contextno-gold-40x300.json")


def norm(w: str) -> str:
    return w.strip().lower().replace("ё", "е")  # ё -> е


def read_pool(path: str):
    raw = open(path, "rb").read()
    nl = raw.index(b"\n")
    hdr = raw[:nl].split()
    if hdr[0] != b"semvec":
        sys.exit("not a semvec asset")
    count, dicthash = int(hdr[2]), hdr[4].decode()
    pos, words = nl + 1, []
    for _ in range(count):
        e = raw.index(b"\n", pos)
        words.append(raw[pos:e].decode())
        pos = e + 1
    return words, dicthash


def main() -> None:
    words, dicthash = read_pool(os.path.join(ASSETS, "ru.vec.bin"))
    harrix = {norm(w) for w in open(HARRIX, encoding="utf8") if w.strip()}
    gold = json.load(open(GOLD, encoding="utf8"))
    goldset = {norm(x) for lst in gold.values() for x in lst} | {norm(k) for k in gold}
    morph = pymorphy3.MorphAnalyzer()

    def noun(w: str) -> bool:
        return any(p.tag.POS == "NOUN" for p in morph.parse(w))

    count = len(words)
    bits = bytearray((count + 7) // 8)
    kept = 0
    for i, w in enumerate(words):
        if w in harrix or w in goldset or noun(w):
            bits[i >> 3] |= 1 << (i & 7)
            kept += 1

    header = f"semsg 1 {count} {dicthash}\n".encode()
    out = os.path.join(ASSETS, "ru.suggestable.bin")
    open(out, "wb").write(header + bytes(bits))
    print(f"ru.suggestable.bin: {kept}/{count} suggestable "
          f"({100 * (count - kept) / count:.1f}% suppressed), {len(header) + len(bits)} bytes")


if __name__ == "__main__":
    main()
