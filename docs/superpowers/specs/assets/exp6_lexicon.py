"""EXPERIMENT 6 — Build a >30k noun-lemma lexicon that is a SUPERSET of the game's vocab.

Strategy: derive the pool from the EMBEDDING's vocabulary (navec 500k, corpus-frequency
ordered) filtered by pymorphy3 to nominative-singular nouns, unioned with the Harrix
noun list. Validate against the 82 game-accepted and 26 game-rejected probe words.
"""
import json
import pymorphy3
from navec import Navec

RAW = "/home/user/src/m/wordlesolv/packages/solver-core/dict/raw"
norm = lambda w: w.strip().lower().replace("ё", "е")
D = json.load(open("game30.json"))
accepted = {norm(w) for w in D["observations"]}
rejected = {norm(w) for w in D["rejected_by_game"]}

nav = Navec.load("navec.tar")
m = pymorphy3.MorphAnalyzer()
CYR = set("абвгдежзийклмнопрстуфхцчшщъыьэюя-")

def is_noun_lemma(w):
    """Nominative-singular noun whose own normal form is itself (i.e. a lemma).
    Mirrors what the game accepts: 'кот' yes, 'кота'/'коты' no, 'бежать'/'красный' no."""
    if not w or not set(w) <= CYR or len(w) < 2 or w.startswith("-") or w.endswith("-"):
        return False
    for p in m.parse(w):
        if p.tag.POS == "NOUN" and p.tag.case == "nomn" and norm(p.normal_form) == w:
            if p.tag.number == "sing" or "Pltm" in p.tag:      # pluralia tantum: деньги, ножницы
                return True
    return False

navec_words = [w for w in nav.vocab.words if set(w) <= CYR]
print(f"navec cyrillic words: {len(navec_words)}")
from_navec = [w for w in navec_words if is_noun_lemma(w)]
print(f"  -> noun lemmas:     {len(from_navec)}")

harrix = {norm(l) for l in open(f"{RAW}/russian_nouns.txt", encoding="utf8") if l.strip()}
harrix_vec = {w for w in harrix if w in nav}
print(f"harrix nouns with vectors: {len(harrix_vec)}")

pool = sorted(set(from_navec) | harrix_vec)
print(f"\nUNION POOL: {len(pool)}  (>30000 -> {'PASS' if len(pool) > 30000 else 'FAIL'})")

ps = set(pool)
miss = sorted(accepted - ps)
fp = sorted(rejected & ps)
print(f"\nrecall on game-ACCEPTED words: {len(accepted & ps)}/{len(accepted)}  missing={miss}")
print(f"leakage of game-REJECTED words: {len(fp)}/{len(rejected)}  -> {fp}")

json.dump(pool, open("pool_v1.json", "w"), ensure_ascii=False)
print(f"\nwrote pool_v1.json ({len(pool)} words)")
