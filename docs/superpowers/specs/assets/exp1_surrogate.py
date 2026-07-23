"""EXPERIMENT 1 — Is a public Russian embedding a usable surrogate for контекстно.рф's ranking?

Ground truth: game #30, secret = "трава", 81 observed (word, rank) pairs.
Test: cosine-similarity ranking under Navec (GloVe hudlit, 500k words, 300d).
Success bar: Spearman rho(observed rank, surrogate rank) > 0.7.
"""
import json, sys
import numpy as np
from scipy.stats import spearmanr
from navec import Navec

D = json.load(open("game30.json"))
secret, obs = D["secret"], D["observations"]

nav = Navec.load("navec.tar")
V = nav.vocab.words
print(f"navec vocab: {len(V)} words, dim {nav.pq.dim}")

def vec(w):
    if w in nav:
        return nav[w]
    return None

missing = [w for w in obs if vec(w) is None]
print(f"observed words missing from navec: {missing}")

s = vec(secret)
pairs = [(w, r) for w, r in obs.items() if vec(w) is not None]
sims = np.array([float(np.dot(vec(w), s) / (np.linalg.norm(vec(w)) * np.linalg.norm(s))) for w, _ in pairs])
observed = np.array([r for _, r in pairs], dtype=float)

# surrogate rank = descending order of cosine similarity
order = np.argsort(-sims)
surrogate_rank = np.empty_like(order)
surrogate_rank[order] = np.arange(1, len(order) + 1)

rho, p = spearmanr(observed, surrogate_rank)
print(f"\n=== Spearman rho (observed vs surrogate, n={len(pairs)}): {rho:.4f}  (p={p:.2e})")

print("\nworst disagreements (observed rank vs surrogate position):")
resid = np.abs(np.argsort(np.argsort(observed)) - np.argsort(np.argsort(surrogate_rank)))
for i in np.argsort(-resid)[:12]:
    print(f"  {pairs[i][0]:<18} observed={int(observed[i]):>6}  surrogate_pos={surrogate_rank[i]:>3}  cos={sims[i]:.3f}")

# --- Can we RECOVER the secret from the observations alone? ---
# For each candidate c in a noun pool, score how well cos(c, w_i) ordering matches observed ranks.
print("\n=== Secret recovery test ===")
words = [w for w, _ in pairs]
M = np.stack([vec(w) for w in words])
M = M / np.linalg.norm(M, axis=1, keepdims=True)

# candidate pool: all navec words that are plausible (cyrillic, len>2), capped for speed
pool = [w for w in V if w.isalpha() and len(w) > 2 and all("а" <= c <= "я" or c == "ё" for c in w)]
print(f"candidate pool: {len(pool)}")
P = np.stack([nav[w] for w in pool])
P = P / np.linalg.norm(P, axis=1, keepdims=True)

S = P @ M.T                      # (pool, observed) cosine
obs_rank_order = np.argsort(np.argsort(observed))   # 0 = closest observed
# score = spearman between (-similarity) ordering and observed ordering, vectorised
sim_rank_order = np.argsort(np.argsort(-S, axis=1), axis=1)
n = len(words)
d2 = ((sim_rank_order - obs_rank_order) ** 2).sum(axis=1)
rho_all = 1 - 6 * d2 / (n * (n * n - 1))

top = np.argsort(-rho_all)[:20]
print("top-20 recovered candidates by rank-correlation with observations:")
for i in top:
    print(f"  {pool[i]:<20} rho={rho_all[i]:.4f}")
print(f"\ntrue secret '{secret}' rho={rho_all[pool.index(secret)]:.4f}, "
      f"position={int((rho_all > rho_all[pool.index(secret)]).sum()) + 1} of {len(pool)}")
