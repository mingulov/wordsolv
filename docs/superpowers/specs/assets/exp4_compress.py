"""EXPERIMENT 4 — How small can the shipped embedding get before the solver degrades?

300d float32 x 22.5k words = 27 MB: far too big for a PWA. Test PCA -> int8.
Metric: does the ranked candidate list from the compressed vectors match the
full-precision one, on the real game #30 observations?
"""
import json, gzip
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
ARR = np.array(POOL)
X = np.stack([nav[w] for w in POOL]).astype(np.float32)
X /= np.linalg.norm(X, axis=1, keepdims=True)
print(f"pool={len(POOL)}  full float32 = {X.nbytes/1e6:.1f} MB")

words = [w for w in obs if w in nav]
r = np.asarray([obs[w] for w in words], float)
wi = np.array([POOL.index(w) for w in words if w in POOL])
words_in = [w for w in words if w in POOL]
r_in = np.asarray([obs[w] for w in words_in], float)

def rank_candidates(M):
    Mn = M / np.linalg.norm(M, axis=1, keepdims=True)
    S = Mn @ Mn[wi].T
    pred = np.argsort(np.argsort(-S, axis=0), axis=0) + 1
    lo, lr = np.log(pred), np.log(r_in)
    s = (((lo - lr) ** 2) / r_in).sum(1)          # w_invrank
    return np.argsort(s)

base_order = rank_candidates(X)
base_pos = int(np.where(ARR[base_order] == secret)[0][0]) + 1
print(f"baseline (float32, 300d): secret #{base_pos}, top5={list(ARR[base_order[:5]])}\n")

# PCA
Xc = X - X.mean(0)
U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
print(f"{'dims':>5} {'quant':>6} {'MB':>7} {'gz MB':>7}  {'secret#':>8}  top5-overlap  top50-overlap")
for d in (300, 192, 128, 96, 64, 48, 32):
    Z = Xc @ Vt[:d].T
    for quant in ("f32", "int8"):
        if quant == "int8":
            scale = np.abs(Z).max(0) / 127.0
            Q = np.clip(np.round(Z / scale), -127, 127).astype(np.int8)
            M = Q.astype(np.float32) * scale
            raw = Q.nbytes + scale.nbytes
        else:
            M = Z.astype(np.float32)
            raw = M.nbytes
        order = rank_candidates(M)
        pos = int(np.where(ARR[order] == secret)[0][0]) + 1
        ov5 = len(set(ARR[order[:5]]) & set(ARR[base_order[:5]]))
        ov50 = len(set(ARR[order[:50]]) & set(ARR[base_order[:50]]))
        gz = len(gzip.compress((Q if quant == "int8" else M).tobytes(), 6)) / 1e6
        print(f"{d:>5} {quant:>6} {raw/1e6:>7.2f} {gz:>7.2f}  {pos:>8}  {ov5}/5           {ov50}/50")
