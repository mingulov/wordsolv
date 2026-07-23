"""EXPERIMENT 11b — frequency-prior sweep, full 86,858-word candidate pool.

Computes the rank matrix ONCE per trial and reuses it across all lambdas
(exp11 recomputed an 86858x300 matmul per lambda, which is why it hung).

    loss(c) = SUM (log p - log r)^2 / r  +  lambda * log(freq_rank(c) + 1)

Goal: keep every word a candidate (recall) while recovering the precision that
the 21k-cutoff run achieved (66% top-10 at N=8, exp10).
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
        if len(w) < 2 or not set(w) <= CYR or w in seen:
            continue
        seen.add(w)
        words.append(w)
        vecs.append(np.fromstring(rest, sep=" ", dtype=np.float32))
A = np.stack(vecs)
A /= np.linalg.norm(A, axis=1, keepdims=True)
idx = {w: i for i, w in enumerate(words)}
ARR = np.array(words)
PRIOR = np.log(np.arange(len(words)) + 1.0)   # file order = descending corpus frequency
RU = 21000                                     # rank universe, matched to the game's vocab
print(f"pool={len(words)}  rank-universe={RU}", flush=True)

rng = np.random.default_rng(11)
TRIALS = 6
LAMS = [0.0, 0.25, 0.5, 1.0, 2.0, 4.0]

print("\nmedian / top10 / top50", flush=True)
print(f"{'N':>4}" + "".join(f"{'lam=' + str(l):>18}" for l in LAMS), flush=True)
for n in (5, 8, 12, 20):
    acc = {l: [] for l in LAMS}
    for s in gold:
        if s not in idx:
            continue
        g = [w for w in gold[s][1:] if w in idx]
        if len(g) < n:
            continue
        for _ in range(TRIALS):
            ws = [g[i] for i in rng.choice(len(g), n, replace=False)]
            r = np.asarray([gold[s].index(w) + 1 for w in ws], float)
            cols = [idx[w] for w in ws]
            S = A @ A[cols].T
            ranks = np.empty_like(S)
            for j in range(S.shape[1]):
                thr = np.sort(S[:RU, j])[::-1]
                ranks[:, j] = np.searchsorted(-thr, -S[:, j], side="left") + 1
            fit = (((np.log(ranks) - np.log(r)) ** 2) / r).sum(1)
            for l in LAMS:
                order = np.argsort(fit + l * PRIOR)
                acc[l].append(int(np.where(ARR[order] == s)[0][0]) + 1)
    row = f"{n:>4}"
    for l in LAMS:
        p = np.array(acc[l])
        row += f"{np.median(p):>7.0f}/{np.mean(p <= 10) * 100:>3.0f}%/{np.mean(p <= 50) * 100:>3.0f}%"
    print(row, flush=True)
