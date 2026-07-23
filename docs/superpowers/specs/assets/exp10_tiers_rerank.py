"""EXPERIMENT 10 — Two fixes for the precision collapse at large dictionary sizes.

FIX A (tiers): keep ALL 86,858 nouns so any word the user guesses has a vector, but
  * rank universe = T1 (~21k, matched to the GAME's vocabulary size)
  * candidate set = T1 only
  T2 words are scorable as observations, never proposed as answers.
  predicted_rank(w | c) = 1 + #{v in T1 : sim(c,v) > sim(c,w)}   (works for w in T2 too)

FIX B (rerank): shortlist top-K with araneum, then re-score those K with a
  navec+araneum ensemble. Cheap (K=200), and tests the "use other models for
  precision" idea directly.
"""
import gzip, json
import numpy as np
from navec import Navec

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
        seen.add(w); words.append(w); vecs.append(np.fromstring(rest, sep=" ", dtype=np.float32))
A = np.stack(vecs); A /= np.linalg.norm(A, axis=1, keepdims=True)
idx = {w: i for i, w in enumerate(words)}
ARR = np.array(words)
print(f"full pool (T1+T2): {len(words)}")

nav = Navec.load(f"{SC}/navec.tar")
have_nav = np.array([w in nav for w in words])
N = np.zeros_like(A)
for i, w in enumerate(words):
    if have_nav[i]:
        N[i] = nav[w]
nn = np.linalg.norm(N, axis=1, keepdims=True); nn[nn == 0] = 1
N /= nn
print(f"navec coverage of pool: {have_nav.sum()} ({have_nav.mean():.0%})")

rng = np.random.default_rng(11)
TRIALS = 6

def run(T1, n, rerank=0, wN=1.0, wA=3.0):
    """T1 = size of ranking universe & candidate set."""
    M = A[:T1]
    secrets = [s for s in gold if s in idx and idx[s] < T1]
    pos = []
    for s in secrets:
        g = [w for w in gold[s][1:] if w in idx]          # observations may come from T2
        if len(g) < n: continue
        for _ in range(TRIALS):
            ws = [g[i] for i in rng.choice(len(g), n, replace=False)]
            r = np.asarray([gold[s].index(w) + 1 for w in ws], float)
            cols = [idx[w] for w in ws]
            S = M @ A[cols].T                              # (T1, n) candidate x observation
            p = np.argsort(np.argsort(-S, axis=0), axis=0) + 1
            loss = (((np.log(p) - np.log(r)) ** 2) / r).sum(1)
            order = np.argsort(loss)
            if rerank:
                K = order[:rerank]
                Sa = A[K] @ A[cols].T
                Sn = N[K] @ N[cols].T
                pa = np.argsort(np.argsort(-Sa, axis=0), axis=0) + 1
                pn = np.argsort(np.argsort(-Sn, axis=0), axis=0) + 1
                # blend in log-rank space, araneum-heavy (exp8 winner)
                lp = (wA * np.log(pa) + wN * np.log(pn)) / (wA + wN)
                # rescale: ranks within the shortlist -> full-T1 scale
                lp = lp + np.log(T1 / max(rerank, 1))
                l2 = (((lp - np.log(r)) ** 2) / r).sum(1)
                K = K[np.argsort(l2)]
                order = np.concatenate([K, order[rerank:]])
            pos.append(int(np.where(ARR[order] == s)[0][0]) + 1)
    p = np.array(pos)
    return len(secrets), np.median(p), np.mean(p <= 10) * 100, np.mean(p <= 50) * 100

print(f"\n{'T1':>7}{'rerank':>8}{'N':>4}{'secrets':>9}{'median':>8}{'top10':>7}{'top50':>7}")
for T1 in (21000, 30000, 86858):
    for n in (5, 8, 12, 20):
        for rr in (0, 200):
            c, med, t10, t50 = run(T1, n, rerank=rr)
            print(f"{T1:>7}{rr if rr else '-':>8}{n:>4}{c:>9}{med:>8.0f}{t10:>6.0f}%{t50:>6.0f}%")
