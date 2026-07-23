"""EXPERIMENT 8 — End-to-end: given N guesses with real game ranks, where does the
solver place the true secret? Plus a weighted-ensemble sweep.

Uses the /first-words gold data (40 secrets x 300 true-ranked words) as the oracle.
This is the headline number for the spec.
"""
import os
import gzip, json
import numpy as np
from navec import Navec

# Working directory holding the downloaded models (navec.tar, araneum.vec.gz)
# and firstwords.json. Defaults to the current directory; override with SC=...
SC = os.environ.get("SC", ".")
norm = lambda w: w.strip().lower().replace("ё", "е")
gold = {norm(k): [norm(x) for x in v] for k, v in json.load(open(f"{SC}/firstwords.json")).items()}
pool = [norm(w) for w in json.load(open(f"{SC}/pool_v1.json"))]
pool = sorted(set(pool) | {w for l in gold.values() for w in l} | set(gold))

nav = Navec.load(f"{SC}/navec.tar")
ara, want = {}, set(pool)
with gzip.open(f"{SC}/araneum.vec.gz", "rt", encoding="utf8") as f:
    next(f)
    for line in f:
        tok, _, rest = line.partition(" ")
        if tok.endswith("_NOUN"):
            w = norm(tok[:-5])
            if w in want and w not in ara:
                ara[w] = np.fromstring(rest, sep=" ", dtype=np.float32)

POOL = [w for w in pool if w in nav and w in ara]
idx = {w: i for i, w in enumerate(POOL)}
ARR = np.array(POOL)
def mat(g):
    M = np.stack([g(w) for w in POOL]).astype(np.float32)
    return M / np.linalg.norm(M, axis=1, keepdims=True)
MN, MA = mat(lambda w: nav[w]), mat(lambda w: ara[w])
print(f"pool={len(POOL)}")

def pred_ranks(M, cols):
    """(pool x len(cols)) predicted rank of each observed word from every candidate."""
    S = M @ M[cols].T
    return np.argsort(np.argsort(-S, axis=0), axis=0) + 1

def solve(words, ranks, wN, wA):
    cols = [idx[w] for w in words]
    r = np.asarray(ranks, float)
    lp = np.zeros((len(POOL), len(words)))
    if wN: lp += wN * np.log(pred_ranks(MN, cols))
    if wA: lp += wA * np.log(pred_ranks(MA, cols))
    lp /= (wN + wA)
    loss = (((lp - np.log(r)) ** 2) / r).sum(1)       # w_invrank, the exp3 winner
    return np.argsort(loss)

rng = np.random.default_rng(11)
secrets = [s for s in gold if s in idx]
WEIGHTS = [(1, 0), (0, 1), (1, 1), (1, 2), (1, 3)]
NOBS = [3, 5, 8, 12, 20]
TRIALS = 6

print(f"\nsecrets={len(secrets)}  trials={TRIALS}  metric = position of true secret in solver's ranking")
print(f"\n{'weights(nav:ara)':<18}{'N obs':>6}{'median':>9}{'p75':>8}{'top10%':>9}{'top50%':>9}{'top200%':>9}")
best = {}
for wN, wA in WEIGHTS:
    for n in NOBS:
        pos = []
        for s in secrets:
            g = [w for w in gold[s][1:] if w in idx]     # exclude the secret itself
            if len(g) < n: continue
            for _ in range(TRIALS):
                # realistic: player's guesses land at assorted depths within top-300
                pick = rng.choice(len(g), n, replace=False)
                ws = [g[i] for i in pick]
                rs = [gold[s].index(w) + 1 for w in ws]
                order = solve(ws, rs, wN, wA)
                pos.append(int(np.where(ARR[order] == s)[0][0]) + 1)
        pos = np.array(pos)
        key = f"{wN}:{wA}"
        best[(key, n)] = np.median(pos)
        print(f"{key:<18}{n:>6}{np.median(pos):>9.0f}{np.percentile(pos,75):>8.0f}"
              f"{np.mean(pos<=10)*100:>8.0f}%{np.mean(pos<=50)*100:>8.0f}%{np.mean(pos<=200)*100:>8.0f}%")
