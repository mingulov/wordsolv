# Sources — semantic-core

## araneum_upos_skipgram_300_2_2018 (RusVectōrēs)

- URL: `https://rusvectores.org/static/models/rusvectores4/araneum/araneum_upos_skipgram_300_2_2018.vec.gz`
- Licence: **CC-BY 4.0**. Attribution required: RusVectōrēs (Kutuzov & Kuzmenko).
  Corpus: Araneum Russicum Maximum, a ~10-billion-word web corpus of Russian
  compiled by Vladimir Benko.
- What we derive: 300-dimensional vectors for Russian noun lemmas. The model is
  lemmatised and UPOS-tagged (`слово_NOUN`), which is why no morphological
  analyser is needed. File order is descending corpus frequency, which supplies
  the frequency prior.
- Build-time only. The 192 MB download is never shipped; only the quantised
  extract `dict/assets/ru.vec.bin` reaches the app.

## russian_nouns.txt (Harrix/Russian-Nouns)

Reused from `packages/solver-core/dict/raw/`, MIT, © 2018-present Sergienko Anton.
Used here as a common-noun whitelist when selecting probe candidates, which
filters out given names and toponyms that araneum tags `NOUN`.

## Attribution

araneum is CC-BY 4.0 and requires attribution; Harrix/Russian-Nouns is MIT.
