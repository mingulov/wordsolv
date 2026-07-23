"""EXPERIMENT 7 — Surrogate fidelity: navec vs araneum vs ensemble, against the GAME's
own neighbour lists (/first-words) for 40 secrets x 300 ranked words.

This is the decisive measurement: how faithfully can we reproduce контекстно.рф's
ranking without their model? Metric: overlap@k and Spearman on the game's top-300.
"""
import gzip, json
import numpy as np
from navec import Navec

SC = "/tmp/claude-1000/-home-user-src-m-wordlesolv/f4230b32-b350-4b3e-94ef-1c43b355ac4a/scratchpad"
norm = lambda w: w.strip().lower().replace("ё", "е")
gold = {norm(k): [norm(x) for x in v] for k, v in json.load(open(f"{SC}/firstwords.json")).items()}
pool = [norm(w) for w in json.load(open(f"{SC}/pool_v1.json"))]

# The game's vocabulary is what we care about; make sure gold words are in the pool.
extra = {w for lst in gold.values() for w in lst} | set(gold)
pool = sorted(set(pool) | extra)
print(f"pool (incl. all gold words): {len(pool)}")

nav = Navec.load(f"{SC}/navec.tar")

# --- araneum: lemma_UPOS -> vector, keep NOUNs ---
ara = {}
want = set(pool)
with gzip.open(f"{SC}/araneum.vec.gz", "rt", encoding="utf8") as f:
    next(f)
    for line in f:
        tok, _, rest = line.partition(" ")
        if not tok.endswith("_NOUN"):
            continue
        w = norm(tok[:-5])
        if w in want and w not in ara:
            ara[w] = np.fromstring(rest, sep=" ", dtype=np.float32)
print(f"araneum NOUN vectors for pool words: {len(ara)}")

# keep only words BOTH models cover, so the comparison is apples-to-apples
POOL = [w for w in pool if w in nav and w in ara]
print(f"pool covered by both models: {len(POOL)}")
idx = {w: i for i, w in enumerate(POOL)}

def matrix(get):
    M = np.stack([get(w) for w in POOL]).astype(np.float32)
    return M / np.linalg.norm(M, axis=1, keepdims=True)

MN = matrix(lambda w: nav[w])
MA = matrix(lambda w: ara[w])
print(f"navec {MN.shape}  araneum {MA.shape}")

def ranks_from(M, s):
    """Predicted rank (1-based) of every pool word, as seen from secret s."""
    sims = M @ M[idx[s]]
    order = np.argsort(-sims)
    r = np.empty(len(POOL), np.int32)
    r[order] = np.arange(1, len(POOL) + 1)
    return r

def spearman(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    n = len(a)
    ra = np.argsort(np.argsort(a)); rb = np.argsort(np.argsort(b))
    return 1 - 6 * ((ra - rb) ** 2).sum() / (n * (n * n - 1))

rows = []
secrets = [s for s in gold if s in idx]
print(f"\nevaluating {len(secrets)} secrets\n")
print(f"{'secret':<12} {'model':<10} {'ov@10':>6} {'ov@50':>6} {'ov@300':>7} {'rho300':>7}")
agg = {}
for s in secrets:
    g = [w for w in gold[s] if w in idx]
    gold_rank = {w: i + 1 for i, w in enumerate(g)}
    rn, ra_ = ranks_from(MN, s), ranks_from(MA, s)
    ens = (np.log(rn) + np.log(ra_)) / 2          # Borda in log-rank space
    variants = {"navec": rn, "araneum": ra_, "ensemble": ens}
    for name, r in variants.items():
        top = [POOL[i] for i in np.argsort(r)[:300]]
        ov10 = len(set(top[:10]) & set(g[:10]))
        ov50 = len(set(top[:50]) & set(g[:50]))
        ov300 = len(set(top) & set(g))
        rho = spearman([gold_rank[w] for w in g], [r[idx[w]] for w in g])
        agg.setdefault(name, []).append((ov10, ov50, ov300, rho))
    if s in ("трава", "море", "кот", "деньги"):
        for name in variants:
            o = agg[name][-1]
            print(f"{s:<12} {name:<10} {o[0]:>5}/10 {o[1]:>5}/50 {o[2]:>6}/300 {o[3]:>7.3f}")

print(f"\n=== MEAN over {len(secrets)} secrets ===")
print(f"{'model':<10} {'ov@10':>8} {'ov@50':>8} {'ov@300':>8} {'rho@300':>8}")
for name, v in agg.items():
    a = np.array(v, float).mean(0)
    print(f"{name:<10} {a[0]:>7.2f}/10 {a[1]:>7.2f}/50 {a[2]:>7.1f}/300 {a[3]:>8.3f}")
