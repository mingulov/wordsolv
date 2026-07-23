"""EXPERIMENT 3 — Fix the loss. Far observations must not drown the near ones.

Findings from exp2: log-rank L2 over ALL observations degrades as far guesses
accumulate. Hypothesis: informative content ~ 1/rank; the surrogate embedding is
locally faithful but globally unreliable, so far observations should act as weak
one-sided constraints, not point targets.
"""
import json
import numpy as np
from navec import Navec

RAW = "/home/user/src/m/wordlesolv/packages/solver-core/dict/raw"
D = json.load(open("game30.json"))
secret = D["secret"]
norm = lambda w: w.strip().lower().replace("ё", "е")
obs = {norm(w): r for w, r in D["observations"].items()}

nav = Navec.load("navec.tar")
nouns = {norm(l) for l in open(f"{RAW}/russian_nouns.txt", encoding="utf8") if l.strip()}
freq = {}
for line in open(f"{RAW}/ru_full.txt", encoding="utf8"):
    p = line.split()
    if len(p) == 2 and norm(p[0]) not in freq:
        freq[norm(p[0])] = len(freq)
POOL = sorted([w for w in nouns if w in nav and w in freq], key=lambda w: freq[w])
P = np.stack([nav[w] for w in POOL]).astype(np.float32)
P /= np.linalg.norm(P, axis=1, keepdims=True)
N = len(POOL)
ARR = np.array(POOL)

def predicted(words):
    W = np.stack([nav[w] for w in words]).astype(np.float32)
    W /= np.linalg.norm(W, axis=1, keepdims=True)
    S = P @ W.T
    return np.argsort(np.argsort(-S, axis=0), axis=0) + 1     # (pool, n_obs)

LOSSES = {
    "l2_logrank":     lambda lo, lr, r: ((lo - lr) ** 2).mean(1),
    "w_invsqrt":      lambda lo, lr, r: (((lo - lr) ** 2) / np.sqrt(r)).sum(1) / (1/np.sqrt(r)).sum(),
    "w_invrank":      lambda lo, lr, r: (((lo - lr) ** 2) / r).sum(1) / (1/r).sum(),
    # one-sided: only penalise a candidate for predicting a near word as far, and
    # for predicting a far word as near; saturate the far tail entirely.
    "hinge_capped":   None,
}

def hinge_capped(lo, lr, r, cap=1000.0):
    """Near observations (r<=cap) are point targets in log space.
    Far observations only assert 'not near': penalise only if predicted much nearer."""
    near = r <= cap
    d = lo - lr
    pen = np.where(near, d ** 2, np.maximum(0.0, -d) ** 2)
    w = np.where(near, 1.0 / np.sqrt(r), 0.15)
    return (pen * w).sum(1) / w.sum()

def evaluate(words, label):
    r = np.asarray([obs[w] for w in words], float)
    pred = predicted(words)
    lo, lr = np.log(pred), np.log(r)
    row = {}
    for name, fn in LOSSES.items():
        s = hinge_capped(lo, lr, r) if name == "hinge_capped" else fn(lo, lr, r)
        order = np.argsort(s)
        pos = int(np.where(ARR[order] == secret)[0][0]) + 1
        row[name] = (pos, list(ARR[order[:3]]))
    print(f"\n{label} (n={len(words)}, best rank seen={int(r.min())})")
    for name, (pos, top3) in row.items():
        print(f"   {name:<14} secret #{pos:<6} top3={top3}")

allw = [w for w in obs if w in nav]
byrank = sorted(allw, key=lambda w: obs[w])

# realistic scenarios: a player has some far guesses + progressively better ones
evaluate([w for w in byrank if obs[w] > 5000][:20], "only far guesses (>5000)")
evaluate([w for w in byrank if obs[w] > 2000][:25], "only mid/far (>2000)")
for best in (3000, 1500, 800, 300, 100, 26):
    ws = [w for w in allw if obs[w] >= best]
    ws = sorted(ws, key=lambda w: obs[w])[:30]
    if len(ws) >= 5:
        evaluate(ws, f"player's best rank so far = {best}")
