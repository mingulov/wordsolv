# Dictionary sources

Raw word lists vendored under `dict/raw/` on 2026-07-18 by `dict/download.sh`.
Compiled into `dict/assets/<lang>-<len>.txt` by `dict/build.ts`. Checksums of
the raw files as downloaded are recorded in `dict/raw/checksums.txt`.

## 1. ENABLE1 (English word list)

- URL: `https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt`
- Download date: 2026-07-18
- License: ENABLE1 (Enhanced North American Benchmark Lexicon) is public
  domain. The `dolph/dictionary` GitHub repo that mirrors it has no `LICENSE`
  file (`raw.githubusercontent.com/dolph/dictionary/master/LICENSE` → HTTP
  404) and its `README.md` does not itself state a license for the repo
  wrapper; the public-domain status is that of the underlying ENABLE1 word
  list, which is the long-standing, widely-redistributed public-domain
  Scrabble-adjacent word list this file reproduces verbatim (one word per
  line).
- What we derive: base vocabulary (valid-word universe) for English, all
  lengths. Filtered to lengths 4-8, normalized (lowercased, `[a-z]+` only).

## 2. FrequencyWords — English (en_50k)

- URL: `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt`
- Download date: 2026-07-18
- License: MIT License, Copyright (c) 2016 Hermit Dave. Read directly from
  `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/LICENSE`:
  ```
  MIT License

  Copyright (c) 2016 Hermit Dave

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  ...
  ```
- What we derive: frequency ranking (`word count` per line, frequency-descending)
  used to split English words into T1 (top `T1_CAP` by frequency) vs T2
  (everything else, alphabetical) per length.

## 3. FrequencyWords — Russian (ru_50k)

- URL: `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt`
- Download date: 2026-07-18
- License: same MIT License as source 2 above (same repo,
  `FrequencyWords/master/LICENSE`, Copyright (c) 2016 Hermit Dave).
- What we derive: frequency ranking for Russian words, same role as source 2
  but for the `ru` language dictionaries.

## 4. Harrix Russian-Nouns

- URL: `https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt`
- Download date: 2026-07-18
- License: MIT License, Copyright © 2018-present Sergienko Anton. Read
  directly from
  `https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/LICENSE.md`
  (this URL returned HTTP 200, not 404 — no fallback lookup was needed):
  ```
  # The MIT License

  Copyright © 2018-present Sergienko Anton

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  ...
  ```
- What we derive: base vocabulary (valid-word universe) for Russian, all
  lengths. Filtered to lengths 4-8, normalized (lowercased, ё→е, `[а-я]+`
  only after normalization).

## Attribution

All four sources are permissively licensed (public domain / MIT) and require
only attribution (MIT) or no restriction at all (public domain). This file is
the record of that attribution and feeds the app's attribution page.
