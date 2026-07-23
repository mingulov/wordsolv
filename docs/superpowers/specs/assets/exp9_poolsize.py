"""EXPERIMENT 9 — How big should the shipped dictionary be?

Bigger pool = better recall (never miss the answer) but worse precision (more junk
candidates can fit the observations). Measure the end-to-end metric across pool sizes.
Pool is araneum noun lemmas ordered by corpus frequency (araneum .vec is freq-ordered).
"""
import gzip, json
import numpy as np

SC = "/tmp/claude-1000/-home-user-src-m-wordlesolv/f4230b32-b350-4b3e-94ef-1c43b355ac4a/scratchpad"
norm = lambda w: w.strip().lower().replace("ё", "е")
CYR = set("абвгдежзийклмнопрстуфхцчшщъыьэюя-")
gold = {norm(k): [norm(x) for x in v] for k, v in json.load(open(f"{SC}/firstwords.json")).items()}

# araneum .vec is emitted in descending corpus frequency -> file order IS the freq prior
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
X = np.stack(vecs)
X /= np.linalg.norm(X, axis=1, keepdims=True)
print(f"araneum noun lemmas: {len(words)}  (frequency-ordered)")

rng = np.random.default_rng(11)
SIZES = [20000, 30000, 45000, 60000, 86858]
NOBS = [5, 8, 12, 20]
TRIALS = 6

print(f"\n{'pool':>7}{'recall':>9}{'N':>5}{'median':>8}{'p75':>7}{'top10':>7}{'top50':>7}{'top200':>8}")
for size in SIZES:
    POOL, M = words[:size], X[:size]
    idx = {w: i for i, w in enumerate(POOL)}
    ARR = np.array(POOL)
    secrets = [s for s in gold if s in idx]
    recall = len(secrets) / len(gold)
    for n in NOBS:
        pos = []
        for s in secrets:
            g = [w for w in gold[s][1:] if w in idx]
            if len(g) < n:
                continue
            for _ in range(TRIALS):
                pick = rng.choice(len(g), n, replace=False)
                ws = [g[i] for i in pick]
                r = np.asarray([gold[s].index(w) + 1 for w in ws], float)
                cols = [idx[w] for w in ws]
                S = M @ M[cols].T
                p = np.argsort(np.argsort(-S, axis=0), axis=0) + 1
                # scale predicted ranks to the game's vocabulary (~21k)
                p = p * (21000.0 / size)
                loss = (((np.log(np.maximum(p, 1)) - np.log(r)) ** 2) / r).sum(1)
                order = np.argsort(loss)
                pos.append(int(np.where(ARR[order] == s)[0][0]) + 1)
        pos = np.array(pos)
        print(f"{size:>7}{recall:>8.0%}{n:>5}{np.median(pos):>8.0f}{np.percentile(pos,75):>7.0f}"
              f"{np.mean(pos<=10)*100:>6.0f}%{np.mean(pos<=50)*100:>6.0f}%{np.mean(pos<=200)*100:>7.0f}%")
