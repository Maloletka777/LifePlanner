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
- Third Apple run (`182b52a`): 35 package tests, iOS and macOS builds and both iPhone simulator UI tests passed. Strengthened the habit UI test to assert the actual outcome value and verify it after relaunch; added three more domain cases, bringing the latest local total to 38. Later build results are recorded separately.
- The stricter UI test exposed a test-expectation mismatch: the accessible field was `State, Success`, not just `Success`. Logs confirmed the correct persisted state; corrected the expected full label in `98d02e2` and reran. Retained and visually inspected the real iPhone 16 Pro screenshot from `95d0bd7`. No passing result was inferred from the failed test run.
- Final Apple run `39131749481` on `98d02e2` passed: 38 package tests, both application builds and both strengthened iPhone UI tests. Retained the compact log and final workflow artefact. Only documentation/evidence/package contents were updated afterwards; no extra testing was repeated without a source change.
- Prepared a research plan and CN6000 evidence notebook. No training, evaluations on external datasets or causal intervention claims were made.

Further Apple validation and any resulting fixes are recorded in `VALIDATION.md` and the branch history.

## Follow-up parity work — 18 October 2026

- Audited active TypeScript operations separately from pure models and archived design. Recorded source references and completion gates in PARITY-AUDIT.md.
- Corrected an initial migration mistake: routine steps retain independent schedules; derived parent progress is an equal mean of applicable steps, with nested containers and no independent parent fact. Replaced the incorrect ordered-step test.
- Added dated selective routine conversion, reparenting, detached observation context, date/time/value correction, checklist closing/reopening facts and safe historical removal. Added an atomic rejection for configuration edits overlapping recorded facts.
- Implemented Daily Focus cards/history, provenance, pin/copy/extend/archive and task conversion from the old schema/design requirements. Wired all five inherited diagnostic models to a new native review screen; this was not an active old screen. Added Growing stop/edit/cap validation.
- Owner confirmed all files were supplied and no personal database is expected. Fresh native state is appropriate; no export is required to continue. No private history was imported.
- Original TypeScript reference suites: 26 pass. Latest native Windows package: 57 pass (51 core, 6 storage). Expanded simulator suite from two to five scenarios. Exact Apple results are recorded in VALIDATION.md.
- Documented remaining differences in flexible period qualification, numeric input and automatic suggestion application. No exact full-parity or physical-device acceptance claim is made. Datasets remain untouched.

- Apple run 39134100848: 56 package tests and both builds passed; checklist state and Daily Focus interaction tests failed. The failure hierarchy showed a journal sheet covering the focus history toolbar. Separated the two actions into distinct List rows.
- Run 39134921918: 57 package tests, both builds and four UI scenarios passed; a new explicit switch assertion showed the checklist toggle had not been enabled by the test. Dismissed the keyboard and targeted the inner UISwitch rather than the labelled row. No result assertions were removed.
- Final run 39135718075, application/test source ae789b20e27989b8377b04aa93dbb7c54b3ac13b: 57 package tests, both builds and all five UI scenarios passed. Retained compact logs and actual final screenshots; visually inspected the converted next-day task screenshot.
- Owner has no Mac and confirmed existing Apple Developer/App Store Connect access. Prepared a manual export-only signed iPhone workflow and secure setup guide. Helper syntax and missing-secret refusal were checked; actual signing/export, account setup and TestFlight upload remain unperformed. No credentials were requested in chat or added to source.

- Subsequent release preparation: run 39137052992 on Xcode 26.3 passed 57 package tests, both Apple builds, unsigned generic-iPhone Release archive and five UI tests. Added the existing prototype icon to the native iOS asset catalogue and declared no non-exempt encryption implementation.
- Owner explicitly authorised distribution certificate/API-key creation and GitHub Secrets storage for signing and TestFlight; separately confirmed the API legal terms before acceptance. Created the native App ID, App Store profile and Developer-role API key. Verified the downloaded certificate/private-key match and profile CMS signature/bundle/team, and configured seven repository secrets. No secrets enter source or review archives.
- Signed archive run 39139994490 started at source c31e9b2 via an explicit export-only tag. TestFlight delivery helper added with upload off by default. App Store Connect still blocks creation of the candidate app record with an agreement notice after fresh sign-in, while Developer shows the agreement accepted today. Upload and physical-device acceptance remain unverified; this infrastructure work is not a data-science result.
- Run 39139994490 completed successfully: signed archive and IPA export both passed. Downloaded artifact hash matches Actions, and IPA metadata confirms native bundle, 0.1.0 (1), iPhoneOS 26.2 SDK, embedded profile and code-signature resources. No Apple upload was attempted because the candidate-record agreement gate remains. The signed artifact is retained locally outside source/review archives.

## 19 October 2026 — TestFlight delivery

- Owner reported Apple Support had cleared the agreement issue. Verified the warning disappeared after renewed sign-in; created separate native app record 6824491469 and an internal Owner Swift Testing group containing only the account owner, automatic distribution off.
- First Apple delivery run 39248028493 was rejected for missing iPad interface orientations. The CI job incorrectly appeared successful because altool returned zero despite JSON product-errors. Recorded the failure explicitly and rejected that run's uploadedToApple evidence.
- Added supported orientation declarations in the project generator and regenerated Xcode project. Updated upload helper to require a positive JSON success-message and reject product-errors/unknown responses; exercised all three cases locally. Retry run 39248476290 at source 2d58491 is pending Apple validation. These deployment changes do not implement or evaluate any data-science model.
- Retry 39248476290 explicitly passed Apple validation/upload; downloaded IPA confirms 0.1.0 (3) and orientation arrays. Observed Apple processing complete, then assigned build 3 to the owner-only internal group. Final group page shows 1 Tester, 1 Build and Testing. No public release or external testing was performed. Physical-iPhone installation/acceptance is still unverified.
