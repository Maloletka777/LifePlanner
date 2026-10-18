# Development log

## 18 October 2026 — scope and evidence

- Owner authorised autonomous backup and Swift rewrite of Live Planner, concurrent dissertation notes and a Data Science integration plan; dataset integration was explicitly deferred.
- Read the Mental Wealth chat and found its source/research workspace. Inspected current README, architecture/research notes, original schedule/tracking/observation/progress/growth rules and database shape. `sources/` in the UNI mirror remained read-only and unchanged.
- Confirmed a clean published baseline, branch `main`, commit `62df10e`, existing repository `Maloletka777/LifePlanner`. Created a separate migration checkout and branch; the baseline was retained.
- Created two file-verified source ZIPs and manifests before coding. Replaced a slow first enumeration with a directory-pruned backup pass; the interrupted zero-byte file is explicitly labelled and not counted as a backup.
- Installed Swift 6.4.1, its required Python 3.10 dependency and Visual Studio 2022 C++ build tools/Windows SDK for actual local compilation. No Apple signing credentials were changed. This environment work does not make SwiftUI a Windows runtime.
- Wrote the native shared package and SwiftUI apps. Selected new development bundle IDs and a separate native SQLite path. No device database or raw research data was imported.
- Selected exact decimal arithmetic, civil Gregorian dates, historical configurations, append-only observation corrections, revision-checked SQLite commits, validation before restore and a pre-restore safety copy.
- Added actual behaviour tests, not tests that merely match source text. The initial 31 domain/storage tests passed on Windows. Four inherited growth-rule tests subsequently brought the local total to 35 passing tests (29 core/growth + 6 storage).
- Added two simulator UI behaviour tests, Xcode iPhone/iPad and Mac targets, and a macOS GitHub Actions workflow. Evidence must identify the run/commit; passing shared-core tests alone is insufficient.
- First Apple run: shared-core/storage tests passed; iOS build exposed non-Sendable Apple notification API results under Swift 6. Replaced object transfer with callback-to-value continuations.
- Second Apple run: shared tests and iOS simulator build passed; Mac build exposed mismatched active architecture between the application and local package. Matched Debug builds to their active destination and reran.
- Prepared a research plan and CN6000 evidence notebook. No training, evaluations on external datasets or causal intervention claims were made.

Further Apple validation and any resulting fixes are recorded in `VALIDATION.md` and the branch history.
