"""EXPERIMENT 13 — Probe ladder as GREEDY MAX-COVERAGE (third attempt).

exp5  k-means over frequency-sorted pool -> junk words.
exp12 farthest-point sampling            -> WORSE than random (picks outliers).

Both optimised the wrong thing: the geometry of the embedding. What actually matters is
covering the distribution of *likely secrets*.

Formulation: a probe p "covers" secret s if p lands in s's top-300 (the threshold where
the solver becomes strong). By approximate symmetry that is: s is in p's top-300
neighbours. So each probe covers a set, and we want the k sets whose union covers the
most probability mass of likely secrets. Classic greedy max-coverage.
"""
import os
import gzip, json
import numpy as np

# Working directory holding the downloaded models (navec.tar, araneum.vec.gz)
# and firstwords.json. Defaults to the current directory; override with SC=...
SC = os.environ.get("SC", ".")
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
print(f"pool={len(words)}", flush=True)

ABSTRACT = ("ость", "ение", "ание", "изм", "ция", "ство", "тие", "ика", "аль", "ура",
            "ота", "изна", "ность", "щина", "ирование", "ация")
PROBES = [i for i, w in enumerate(words[:6000]) if not w.endswith(ABSTRACT) and len(w) >= 4]
SECRETS = 20000                       # proxy universe of plausible secrets
# secrets weighted by frequency prior: common words are likelier to be chosen as answers
W = 1.0 / np.log(np.arange(SECRETS) + np.e)
W /= W.sum()
print(f"probe candidates={len(PROBES)}  proxy secrets={SECRETS}", flush=True)

# covered[p] = boolean mask over proxy secrets that probe p lands within top-300 of
TOP = 300
cov = np.zeros((len(PROBES), SECRETS), dtype=bool)
P = A[PROBES]
CH = 512
for a in range(0, SECRETS, CH):
    b = min(a + CH, SECRETS)
    S = A[a:b] @ P.T                                  # (secrets_chunk, probes)
    # for each secret column, which probes are in its top-300 among the probe set?
    # rank probes by similarity to that secret; but "top-300 of the FULL pool" is the real
    # condition, so use a similarity threshold taken from the secret's own 300th neighbour.
    full = A[a:b] @ A.T                               # (chunk, pool)
    thr = np.partition(full, -TOP, axis=1)[:, -TOP]   # 300th largest similarity
    cov[:, a:b] = (S >= thr[:, None]).T
    del full
print(f"coverage matrix built: mean probe covers {cov.sum(1).mean():.0f} secrets", flush=True)

def greedy(k):
    picked, remaining = [], W.copy()
    for _ in range(k):
        gain = cov @ remaining
        j = int(np.argmax(gain))
        picked.append(PROBES[j])
        remaining = remaining * (~cov[j])
    return picked

ladder = greedy(40)
print(f"\ngreedy max-coverage ladder (first 20): {[words[i] for i in ladder[:20]]}", flush=True)

def evaluate(probe_idx, label):
    print(f"\n{label}")
    print(f"{'k':>4}{'reached top-300':>18}{'median best rank':>20}")
    for k in (3, 5, 10, 20, 30, 40):
        hits, bests = 0, []
        n = 0
        for s, lst in gold.items():
            if s not in idx: continue
            n += 1
            rank = {w: i + 1 for i, w in enumerate(lst)}
            best = min((rank.get(words[i], 10**9) for i in probe_idx[:k]), default=10**9)
            if best <= 300:
                hits += 1; bests.append(best)
        med = int(np.median(bests)) if bests else None
        print(f"{k:>4}{hits/n:>17.0%}{(str(med) if med else '-'):>20}")

evaluate(ladder, "GREEDY MAX-COVERAGE LADDER")

rng = np.random.default_rng(3)
print("\nRANDOM COMMON-NOUN BASELINE (20 draws)")
print(f"{'k':>4}{'reached top-300':>18}")
for k in (3, 5, 10, 20, 30, 40):
    fr = []
    for _ in range(20):
        rnd = list(rng.choice(PROBES, 40, replace=False))[:k]
        hits = n = 0
        for s, lst in gold.items():
            if s not in idx: continue
            n += 1
            rank = {w: i + 1 for i, w in enumerate(lst)}
            if min((rank.get(words[i], 10**9) for i in rnd), default=10**9) <= 300:
                hits += 1
        fr.append(hits / n)
    print(f"{k:>4}{np.mean(fr):>17.0%}")
