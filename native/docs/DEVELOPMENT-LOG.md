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

## 20 October 2026 — restore the owner's design

- Owner reported installing the native app and smooth operation, but identified that the original design had been replaced. This is limited user feedback, not a completed physical-device acceptance checklist. Owner requested the original warm palette/calendar/navigation with native Apple transitions and appropriate Liquid Glass.
- Created and hash-verified a separate pre-design source ZIP. Restored the screenshot's sand/cream/forest palette, weekly date rail, time agenda, empty-day action and Today / Overview / More navigation. Retained existing editors, history, routines, Growing, backups and SQLite/domain code; no schema change.
- Followed Apple's standard navigation/forms/material behaviour rather than reproducing custom web-style controls. Custom glass is limited to the floating add control with availability fallback; a dark counterpart follows system appearance and date-selection animation respects Reduce Motion.
- The first Swift type-check attempt on mixed agenda entries failed; split construction into typed steps. First simulator run passed data tests, both Apple builds/archive, checklist, habit, navigation and routine scenarios. Task/focus assertions failed because a one-text native NavigationLink was exposed as Button rather than child StaticText. The captured hierarchy contained the correct persisted task. Updated tests to identify the exact title independently of element type without removing persistence assertions.
- Added timed-task creation/relaunch and appearance screenshots. The timed scenario passed; the initial dark screenshot did not switch appearance, so added a Debug-only deterministic dark test launch flag. Release behaviour still follows system appearance. Final source and screenshots are under revalidation; TestFlight build 3 remains the previous delivered interface until the new build is verified.


## Verified delivery — 20 October 2026

Restored design delivered as **0.1.0 (6)**, app source `f8a05991842d6e71038875536517c8582e87417a`. Validation run [39428457294](https://github.com/Maloletka777/LifePlanner/actions/runs/39428457294) completed successfully: 57 core/storage tests, all seven UI scenarios, iPhone simulator and macOS builds, and unsigned Release archive. Screenshot evidence is from artifact 12268047156 on iPhone 17 Pro; see images/design-build6-empty-day.png, design-build6-dark.png and design-build6-timed-task.png.

Signed delivery run [39428455492](https://github.com/Maloletka777/LifePlanner/actions/runs/39428455492) explicitly passed Apple validation and upload. Separate App Store Connect API verification confirmed build 6 processing VALID, membership in the existing internal Owner Swift Testing group, and internalBuildState IN_BETA_TESTING. Builds 4 and 5 were intermediate uploads and were not assigned to that group. Public release was not performed.

The later c295e4f commit changes only the UI-test scroll helper, not application code; its additional validation run is 39429839161. The delivered app's own complete validation above is green. Source/core/database schema were unchanged by this visual restoration. The owner reported smooth operation of the previous native build; physical acceptance of this new design, larger text, landscape and Reduce Transparency remain pending. This does not claim complete parity with every historical TypeScript feature or any new data-science result.

## 20 October: correct the design reference to 0.5.9 build 40

Owner rejected build 6 warm theme: it came from an older screenshot. Confirmed last published TypeScript source 62df10e, version 0.5.9/build 40. Swift app correction 5baa27c; candidate/test source 821576b. Restored graphite/system-dark palette, four tabs including Growth, stored day-block journal and compact plates. Block-specific creation preserves the selected block without inferring it from the time. Native interactions, existing Swift data and core remain intact. Added an explicit block creation/collapse/relaunch UI scenario (eight scenarios total). Validation run 39440890089 and signed-delivery tag testflight-20261020-v059-01 are pending; do not infer success or owner availability from these starts.

Candidate correction 38b1dfe fixes UTF-8 punctuation in labels; the previous 821576b UI run exposed an accessibility lookup mismatch against the unchanged habit-editor label. Build 7 was uploaded/processed but deliberately not assigned. Replacement validation 39442408506 and signed run 39442418274 are pending.

The explicit-block UI assertion exposed stale state captured by the boolean SwiftUI creation sheet: Morning creation could still use Anytime. Candidate 507d393 binds sheet presentation to an identifiable request carrying the block. Validation 39443649894 and signed run 39443662539 now check this correction. Build 8 is withheld from the owner group, as was build 7. Earlier screenshots are intermediate evidence only.

## Verified corrected delivery: 0.1.0 (9), 20 October 2026

Reference: final published TypeScript 0.5.9 / iOS build 40, commit 62df10e. Delivered Swift source **507d393a7de619c02d43b70c730a0e4797c39bb4**. [Validation run 39443649894](https://github.com/Maloletka777/LifePlanner/actions/runs/39443649894) completed successfully: **57 core/storage tests and all eight UI scenarios**, iPhone simulator build, macOS build and unsigned Release archive. The new explicit-block scenario passes creation in Morning, collapse/reopen and persistence after relaunch. UTF-8 checklist labels and existing completion workflows pass.

[Signed run 39443662539](https://github.com/Maloletka777/LifePlanner/actions/runs/39443662539) explicitly returned VERIFY SUCCEEDED and UPLOAD SUCCEEDED. Artifact 12273744210 is signed-iphone-9. Separate App Store Connect API verification confirmed build 9 processing VALID, membership in the existing Owner Swift Testing internal group and internalBuildState IN_BETA_TESTING. Builds 7 and 8 were intermediate uploads and were not assigned. Build 6 remains historical and was rejected as the wrong design reference. No public App Store release.

Final simulator screenshots from artifact 12276371792, iPhone 17 Pro/iOS 26.2, are images/design-build9-day-journal.png, design-build9-dark.png and design-build9-empty-day.png. Visually checked graphite light/true-black dark, four tabs, compact plates and correct Morning placement. Screenshots contain test records. Physical-device acceptance and larger text/landscape/Reduce Transparency checks remain pending.

No Swift core, storage or schema changes from the pre-correction source. Existing native functional scope is retained; this is a native adaptation of the final visual language, not a claim of full historical TypeScript feature/animation parity. The custom calendar lens and Overview folder animation are not replicated. No datasets or predictive models were added.

Rollback source/views archive: LivePlanner-Swift-before-v059-design.zip, SHA256 77977f01de464c9e21132142720cc1608887f481888bdc06010e5baf01ad81e1, integrity verified and excludes signing material.
