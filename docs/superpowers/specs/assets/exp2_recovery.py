"""EXPERIMENT 2 — Secret recovery with a game-shaped pool (RU noun lemmas x navec).

Also compares candidate-scoring losses, and simulates the real solver loop:
given only the first N guesses, where does the true secret rank?
"""
import json, unicodedata
import numpy as np
from navec import Navec

RAW = "/home/user/src/m/wordlesolv/packages/solver-core/dict/raw"
D = json.load(open("game30.json"))
secret, obs = D["secret"], D["observations"]

def norm(w):
    return w.strip().lower().replace("ё", "е")

nav = Navec.load("navec.tar")

# --- pool: noun lemmas, frequency-ordered, present in navec ---
nouns = {norm(l) for l in open(f"{RAW}/russian_nouns.txt", encoding="utf8") if l.strip()}
freq = {}
for line in open(f"{RAW}/ru_full.txt", encoding="utf8"):
    p = line.split()
    if len(p) == 2:
        w = norm(p[0])
        if w not in freq:
            freq[w] = len(freq)

# navec is unlemmatized but contains lemmas too; keep nouns that navec knows
pool = [w for w in nouns if w in nav and w in freq]
pool.sort(key=lambda w: freq[w])
print(f"noun lemmas: {len(nouns)}, with freq+vector: {len(pool)}")
for cap in (10000, 20000, 30000, 40000, len(pool)):
    print(f"  top-{cap}: contains secret={secret in pool[:cap]}")

POOL = pool[:30000]
idx = {w: i for i, w in enumerate(POOL)}
P = np.stack([nav[w] for w in POOL]).astype(np.float32)
P /= np.linalg.norm(P, axis=1, keepdims=True)
print(f"pool matrix {P.shape}, {P.nbytes/1e6:.1f} MB float32")

obs_n = {norm(w): r for w, r in obs.items()}
print(f"observations in pool: {sum(1 for w in obs_n if w in idx)}/{len(obs_n)}")


def score(words, ranks, mode):
    """Return array over POOL: lower = better fit."""
    W = np.stack([nav[w] for w in words]).astype(np.float32)
    W /= np.linalg.norm(W, axis=1, keepdims=True)
    S = P @ W.T                                    # (pool, n_obs) cosine
    # predicted rank of each observed word from each candidate: position in pool by cosine
    pred = np.argsort(np.argsort(-S, axis=0), axis=0) + 1   # (pool, n_obs)
    lo, lr = np.log(pred), np.log(np.asarray(ranks, float))
    if mode == "spearman":
        n = len(words)
        oo = np.argsort(np.argsort(np.asarray(ranks, float)))
        so = np.argsort(np.argsort(pred, axis=1), axis=1)
        return ((so - oo) ** 2).sum(axis=1) / (n * (n * n - 1))
    if mode == "logrank_l2":
        return ((lo - lr) ** 2).mean(axis=1)
    if mode == "logrank_weighted":          # near observations matter more
        w = 1.0 / np.log(np.asarray(ranks, float) + np.e)
        return (((lo - lr) ** 2) * w).sum(axis=1) / w.sum()
    raise ValueError(mode)


print("\n=== Full-information recovery (all 82 observations) ===")
words = [w for w in obs_n if w in nav]
ranks = [obs_n[w] for w in words]
for mode in ("spearman", "logrank_l2", "logrank_weighted"):
    s = score(words, ranks, mode)
    order = np.argsort(s)
    pos = int(np.where(np.array(POOL)[order] == secret)[0][0]) + 1
    print(f"{mode:<18} secret at #{pos:<5} top5={[POOL[i] for i in order[:5]]}")

print("\n=== Progressive: solver sees only the first N guesses (worst-first order) ===")
# realistic play order: a player starts with random-ish words, gets closer.
seq = sorted(words, key=lambda w: -obs_n[w])       # far -> near, like real play
for mode in ("logrank_l2", "logrank_weighted"):
    print(f"\n-- {mode} --")
    for n in (3, 5, 10, 20, 40, 60, len(seq)):
        ws = seq[:n]
        s = score(ws, [obs_n[w] for w in ws], mode)
        order = np.argsort(s)
        arr = np.array(POOL)[order]
        pos = int(np.where(arr == secret)[0][0]) + 1
        print(f"  after {n:>3} guesses: secret at #{pos:<6} top5={list(arr[:5])}")
