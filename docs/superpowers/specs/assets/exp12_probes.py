"""EXPERIMENT 12 — Build and MEASURE the cold-start probe ladder (now a v1 requirement).

exp5's k-means attempt failed (picked 'это', 'супер', 'отстой'). This does what the spec
requires instead:
  1. restrict probes to common, concrete, provider-valid nouns
  2. select by farthest-point sampling in embedding space
  3. measure against the gold fixture, vs a random-common-noun baseline

Metric: after k probes, has any probe landed inside the game's top-300 (the threshold at
which the solver becomes strong)? And how good is the best rank reached?
"""
import gzip, json
import numpy as np

SC = "/tmp/claude-1000/-home-user-src-m-wordlesolv/f4230b32-b350-4b3e-94ef-1c43b355ac4a/scratchpad"
norm = lambda w: w.strip().lower().replace("ё", "е")
CYR = set("абвгдежзийклмнопрстуфхцчшщъыьэюя-")
gold = {norm(k): [norm(x) for x in v] for k, v in json.load(open(f"{SC}/firstwords.json")).items()}

words, vecs, seen = [], [], set()
with gzip.open(f"{SC}/araneum.vec.gz", "rt", encoding="utf8") as f:
    next(f)
    for line in f:
        tok, _, rest = line.partition(" ")
        w, _, pos = tok.rpartition("_")
        if pos != "NOUN":
            continue
        w = norm(w)
        if len(w) < 3 or not set(w) <= CYR or w in seen:
            continue
        seen.add(w); words.append(w); vecs.append(np.fromstring(rest, sep=" ", dtype=np.float32))
A = np.stack(vecs); A /= np.linalg.norm(A, axis=1, keepdims=True)
idx = {w: i for i, w in enumerate(words)}
print(f"pool={len(words)}")

# --- probe candidates: common + concrete ---
# abstract-noun suffixes; a concreteness lexicon would be better but this is cheap and
# removes exactly the class that polluted exp5.
ABSTRACT = ("ость", "ение", "ание", "изм", "ция", "ство", "тие", "ика", "аль", "ура",
            "ота", "изна", "ность", "щина", "ирование", "ация")
COMMON = 6000
probe_pool = [i for i, w in enumerate(words[:COMMON])
              if not w.endswith(ABSTRACT) and len(w) >= 4]
print(f"probe candidates (common, concrete): {len(probe_pool)}")

def farthest_point(cands, k, seed_i):
    """Greedy max-min-cosine-distance selection."""
    picked = [seed_i]
    C = A[cands]
    best = C @ A[seed_i]                       # similarity to nearest picked
    for _ in range(k - 1):
        j = int(np.argmin(best))
        picked.append(cands[j])
        best = np.maximum(best, C @ A[cands[j]])
    return picked

seed = probe_pool[0]
ladder = farthest_point(probe_pool, 40, seed)
print(f"\nfarthest-point ladder (first 20): {[words[i] for i in ladder[:20]]}")

# --- evaluation ---
def evaluate(probe_idx, label):
    rows = []
    for k in (3, 5, 10, 20, 30, 40):
        hits, bests = 0, []
        for s, lst in gold.items():
            if s not in idx:
                continue
            rank = {w: i + 1 for i, w in enumerate(lst)}
            best = min((rank.get(words[i], 10**9) for i in probe_idx[:k]), default=10**9)
            if best <= 300:
                hits += 1
                bests.append(best)
        n = sum(1 for s in gold if s in idx)
        med = int(np.median(bests)) if bests else None
        rows.append((k, hits / n, med))
    print(f"\n{label}")
    print(f"{'k':>4}{'reached top-300':>18}{'median best rank':>20}")
    for k, frac, med in rows:
        print(f"{k:>4}{frac:>17.0%}{(str(med) if med else '-'):>20}")

evaluate(ladder, "FARTHEST-POINT LADDER")

rng = np.random.default_rng(3)
accf = {k: [] for k in (3, 5, 10, 20, 30, 40)}
for _ in range(20):
    rnd = list(rng.choice(probe_pool, 40, replace=False))
    for k in accf:
        hits = 0; n = 0
        for s, lst in gold.items():
            if s not in idx: continue
            n += 1
            rank = {w: i + 1 for i, w in enumerate(lst)}
            if min((rank.get(words[i], 10**9) for i in rnd[:k]), default=10**9) <= 300:
                hits += 1
        accf[k].append(hits / n)
print("\nRANDOM COMMON-NOUN BASELINE (20 draws)")
print(f"{'k':>4}{'reached top-300':>18}")
for k in sorted(accf):
    print(f"{k:>4}{np.mean(accf[k]):>17.0%}")
