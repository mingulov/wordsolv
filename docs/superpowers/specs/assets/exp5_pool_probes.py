"""EXPERIMENT 5 — (a) pool coverage vs the >30k requirement, (b) cold-start probe set.

(a) Our candidate pool must be a SUPERSET of the game's vocabulary: a word the
    game knows but we lack is an unwinnable puzzle. Measure how big we can get.
(b) Cold start is the weak regime. Design a diverse probe set by k-means over the
    embedding and measure the best rank it achieves for a random secret.
"""
import json
import numpy as np
from navec import Navec

RAW = "/home/user/src/m/wordlesolv/packages/solver-core/dict/raw"
norm = lambda w: w.strip().lower().replace("ё", "е")
D = json.load(open("game30.json"))
obs = {norm(w): r for w, r in D["observations"].items()}
rejected = {norm(w) for w in D["rejected_by_game"]}

nav = Navec.load("navec.tar")
nouns = sorted({norm(l) for l in open(f"{RAW}/russian_nouns.txt", encoding="utf8") if l.strip() and l.strip().isalpha()})
freq = {}
for line in open(f"{RAW}/ru_full.txt", encoding="utf8"):
    p = line.split()
    if len(p) == 2 and norm(p[0]) not in freq:
        freq[norm(p[0])] = len(freq)

print("=== (a) pool coverage ===")
have_vec = [w for w in nouns if w in nav]
have_both = [w for w in have_vec if w in freq]
print(f"noun lemmas (alpha):        {len(nouns)}")
print(f"  ... with a navec vector:  {len(have_vec)}")
print(f"  ... and a frequency rank: {len(have_both)}")

# does the pool cover every word the GAME accepted?
accepted = [w for w in obs]
miss_noun = [w for w in accepted if w not in set(nouns)]
miss_vec = [w for w in accepted if w not in nav]
print(f"\ngame-accepted words missing from noun list: {len(miss_noun)}/{len(accepted)} -> {miss_noun}")
print(f"game-accepted words missing from navec:     {len(miss_vec)}/{len(accepted)} -> {miss_vec}")
# and do we correctly NOT contain what the game rejected?
false_pos = [w for w in rejected if w in set(have_vec)]
print(f"game-rejected words our pool WOULD suggest: {len(false_pos)}/{len(rejected)} -> {false_pos}")

POOL = have_vec  # maximise recall; frequency only used for ordering/priors
rank_of = {w: freq.get(w, len(freq)) for w in POOL}
POOL.sort(key=lambda w: rank_of[w])
ARR = np.array(POOL)
X = np.stack([nav[w] for w in POOL]).astype(np.float32)
X /= np.linalg.norm(X, axis=1, keepdims=True)
print(f"\nFINAL POOL: {len(POOL)} words   (requirement: >30000 -> {'PASS' if len(POOL) > 30000 else 'FAIL'})")

print("\n=== (b) cold-start probe set (k-means over pool, navec-as-truth) ===")
rng = np.random.default_rng(7)

def kmeans(X, k, iters=25):
    C = X[rng.choice(len(X), k, replace=False)].copy()
    for _ in range(iters):
        a = np.argmax(X @ C.T, axis=1)
        for j in range(k):
            m = X[a == j]
            if len(m):
                C[j] = m.mean(0) / np.linalg.norm(m.mean(0))
    return C, np.argmax(X @ C.T, axis=1)

# restrict probe candidates to common words (a player types real words)
COMMON = min(8000, len(POOL))
for k in (8, 12, 16, 24, 32):
    C, assign = kmeans(X[:COMMON], k)
    # probe = most frequent word in each cluster
    probes = []
    for j in range(k):
        members = np.where(assign == j)[0]
        if len(members):
            probes.append(int(members[0]))          # POOL is freq-sorted
    Pv = X[probes]
    # for 2000 random secrets, what's the best (smallest) true rank among probes?
    secrets = rng.choice(len(POOL), 2000, replace=False)
    best = []
    for s in secrets:
        sims = X @ X[s]
        order = np.argsort(-sims)
        rank = np.empty(len(POOL), int); rank[order] = np.arange(1, len(POOL) + 1)
        best.append(rank[probes].min())
    best = np.array(best)
    print(f"k={k:>3} probes={[POOL[i] for i in probes[:6]]}...")
    print(f"      best-probe rank: median={np.median(best):>6.0f}  p25={np.percentile(best,25):>6.0f} "
          f"p75={np.percentile(best,75):>7.0f}  P(<1000)={np.mean(best<1000):.2f}  P(<300)={np.mean(best<300):.2f}")
