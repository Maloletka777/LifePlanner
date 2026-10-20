# Validation record

## Local Windows checks

Swift 6.4.1, Visual Studio 2022 Build Tools 17.14, x64 Windows SDK. `tools/test-windows.ps1` builds the actual package, the vendored SQLite C library, PlannerCore and PlannerStorage and executes XCTest suites.

Latest local result: **57 tests passed, zero failures** — 28 planner domain tests, 4 growth-rule tests, 4 diagnosis tests, 15 parity regressions and 6 SQLite persistence tests. The exact output is retained in `windows-test-results.txt`. Swift's separate new Testing runner reports zero tests because these suites use XCTest; that is not the total suite count. A Windows warning about an optional `.build/debug` symbolic link did not prevent builds/tests.

Coverage includes civil/DST dates, clamped month/leap dates, weekday/interval/flexible periods, missing/false/avoidance distinction, exact decimal accumulation, corrections and voids, future rejection, historic configuration edits, lifecycle boundaries, cycles, prerequisites/follow-ups, independent routine steps and nested derived parents, dated conversion/reparenting, detached context, cross-date corrections, checklist close/reopen history, Daily Focus operations, growth lifecycle/diagnostic rules, recursive deletion, reminder plan bounds, reopen/persistence, stale writers, invalid import, safety backup and corrupt-file preservation. A rejected backdated configuration edit is tested to leave the original state unchanged.

The original TypeScript routine-step and diagnosis suites were also run: **26 passed**, retained in `legacy-parity-tests.txt`. These are a reference suite, not 26 additional Swift tests or proof of complete equivalence. The initially incorrect Swift ordered-step test was replaced after checking the original read model. Known differences are stated in `MIGRATION.md`.

All `AppleApp/*.swift` files were also parsed by the compiler on Windows. Parsing is not SwiftUI type checking or execution.

## Apple build evidence

GitHub Actions workflow: `Native Swift validation`, branch `swift-migration`.

- [Run 39130388765](https://github.com/Maloletka777/LifePlanner/actions/runs/39130388765), commit `284e444`: package tests passed; iOS compilation found the notification concurrency issue.
- [Run 39130564349](https://github.com/Maloletka777/LifePlanner/actions/runs/39130564349), commit `6536b74`: package tests and iOS simulator build passed; macOS build found the debug architecture mismatch.
- [Run 39130769441](https://github.com/Maloletka777/LifePlanner/actions/runs/39130769441), commit `182b52a`: **successful overall**. All 35 then-current package tests passed on macOS, both iOS simulator and macOS applications built successfully, and both iPhone UI tests passed (habit creation/recording and task persistence after relaunch). This used the original UI assertions; the later version strengthens the habit-state and restart assertions and adds three domain cases.
- [Earlier successful run 39131749481](https://github.com/Maloletka777/LifePlanner/actions/runs/39131749481), commit `98d02e233dcce1a9aa33deececc73e8f066b8ba6`: **successful overall**. All **38 package tests** passed on macOS; both **iOS simulator and macOS builds** passed; both **iPhone UI tests** passed, including explicit state checks before/after recording and habit/task persistence after relaunch. The compact log is `apple-validation-summary.txt`. That result applies to that source revision; follow-up application changes are recorded separately below.

The stricter state-label test initially failed because SwiftUI's accessibility label combines the field name and value (`State, Success`), while the assertion expected only `Success`. The captured result before and after relaunch was correctly `State, Success`; the expected label was corrected without changing application behaviour. This is recorded as a test failure, not hidden as a passing run.

`images/iphone-habit-success.png` is an actual iPhone 16 Pro simulator screenshot exported from the successful final run [39131749481](https://github.com/Maloletka777/LifePlanner/actions/runs/39131749481), commit `98d02e2`. It shows the successfully persisted habit after relaunch. The final screenshot was visually inspected for this screen only; it is not a full UI or physical-device acceptance report.

Xcode 16.4 / Apple Swift 6.1.2 were reported by the first runners. Native package supports Swift tools 6.0 and does not require the newer Windows compiler's language features.

## Follow-up parity validation

- Run [39134100848](https://github.com/Maloletka777/LifePlanner/actions/runs/39134100848), source `42a26d9`: 56 package tests and both Apple builds passed. Three of five simulator scenarios passed (habit, task restart, derived routine parent). The checklist scenario failed two state assertions; the Daily Focus scenario failed because a journal sheet covered the history toolbar. The captured accessibility hierarchy confirms the simultaneous sheet, rather than a build failure.
- Follow-up `89d99a9` separates the journal button and history navigation into different List rows, targets the actual checklist switch control and asserts its enabled value before saving, and adds a regression protecting recorded history from backdated configuration edits. Local result is 57 passing package tests. Apple revalidation is recorded below when observed; no success is inferred from the earlier build.
- Run [39134921918](https://github.com/Maloletka777/LifePlanner/actions/runs/39134921918), source `89d99a9`: 57 package tests and both builds passed; four UI scenarios passed, including Daily Focus. The checklist switch remained off, as the new pre-save assertion showed. The test was corrected to dismiss the title keyboard and tap the inner UISwitch exposed beneath the labelled SwiftUI row, retaining all final state assertions.
- **Latest successful run [39135718075](https://github.com/Maloletka777/LifePlanner/actions/runs/39135718075)**, application/test source **`ae789b20e27989b8377b04aa93dbb7c54b3ac13b`**: **57 package tests, both iOS/macOS builds and all 5 iPhone UI tests passed**. These cover checklist-owned completion/reopening, habit recording/restart, task persistence, Daily Focus conversion to a next-day task/restart, and a derived routine parent. See `apple-parity-validation-summary.txt`. The actual final Daily Focus task screenshot is `images/iphone-focus-converted-task.png`, visually inspected; `images/iphone-parity-habit-success.png` is the final habit screenshot. These are simulator evidence, not physical-device acceptance.

Later changes to signing preparation/documentation do not alter the tested application/test sources. The separate manual signed-archive helper was syntax-checked and verified to refuse missing secrets. Its actual macOS signing/export workflow has not been executed and is not covered by the passing simulator run.

## Acceptance still required

Release SDK preflight: run [39137052992](https://github.com/Maloletka777/LifePlanner/actions/runs/39137052992), source `5881ab7b751af419704b7bb913cfe27d7c4ec987`, passed on Xcode 26.3: 57 package tests, iOS simulator and macOS builds, an unsigned Release archive for generic iPhone, and all five simulator UI tests. See `apple-release-preflight.txt`. This confirms the current SDK build, not distribution signing, Apple upload acceptance or physical-device acceptance.

Signed export: run [39139994490](https://github.com/Maloletka777/LifePlanner/actions/runs/39139994490), source `c31e9b2bea22ab1cea824ec76a39019a41e3a202`, successfully archived and exported a distribution-signed App Store Connect IPA, version 0.1.0 (1). The downloaded ZIP matches the SHA256 recorded by Actions. See `apple-signed-export-summary.txt`. Upload was skipped for this export-only run; the App Store Connect candidate-record agreement gate remains unresolved. This result supersedes the earlier statement that signing/export had not executed, but does not establish TestFlight availability.

- The source revision and automated acceptance must be read with their exact runs above. Broader UI flows and physical devices still require the following checks.
- Install a signed candidate beside the existing iPhone app; confirm no original database/container is affected.
- Create/edit all schedule and tracking variants, archived/future habits, tasks and checklists; reload and restore backup after restart.
- Check notification permission denial, scheduling, delivery, travel/DST, disabled reminders and app inactivity beyond the 30-day horizon. The planner reconciles on activation and edits; indefinite background refresh is not implemented.
- Check VoiceOver labels, Dynamic Type, dark mode, small screens, keyboards, date/time zones, Mac keyboard navigation and window resizing.
- Compare inherited advanced semantics against legacy fixtures before claiming full parity or importing real history. See `MIGRATION.md` for known differences.
- Measure responsiveness and database size with realistic large histories. The current aggregate storage and repeated per-day calculations are intentionally simple and have no scalability claim.

No App Store/TestFlight release, physical-iPhone usability acceptance, Watch app, inter-device sync, trained model or behavioural-effectiveness trial has been performed.

## 19 October delivery follow-up

Final outcome: App Store Connect processed **0.1.0 (3)** and its internal group **Owner Swift Testing** shows **1 Tester, 1 Build**, status **Testing**. The account owner is the sole tester. This verifies TestFlight delivery/internal availability; it does not verify installation, notification delivery or other physical-device acceptance.

Apple cleared the account agreement block and the separate app record is 6824491469. Run 39248028493's first upload was rejected for missing iPad orientation declarations despite a zero altool exit code; that run's successful CI badge and uploadedToApple evidence are not proof of delivery. Source 2d58491 adds supported orientations and requires an explicit positive Apple JSON response. Local response handling checks cover success, product-errors and unrecognised output.

Retry run [39248476290](https://github.com/Maloletka777/LifePlanner/actions/runs/39248476290), source `2d58491d71b6745b9eac0d98b5324e525f542a37`, passed signed export and Apple validation/upload with explicit success-message responses. The exported IPA is 0.1.0 (3) and contains all four generic/iPad orientation values as arrays. App Store Connect shows that exact build under Build Uploads as Processing. Group assignment and installation are not yet verified. See `apple-testflight-upload-summary.txt` and `TESTFLIGHT-UPLOAD-STATUS.md`; these later observations supersede earlier no-upload statements above, but not physical-device or research limitations.


## Verified delivery — 20 October 2026

Restored design delivered as **0.1.0 (6)**, app source `f8a05991842d6e71038875536517c8582e87417a`. Validation run [39428457294](https://github.com/Maloletka777/LifePlanner/actions/runs/39428457294) completed successfully: 57 core/storage tests, all seven UI scenarios, iPhone simulator and macOS builds, and unsigned Release archive. Screenshot evidence is from artifact 12268047156 on iPhone 17 Pro; see images/design-build6-empty-day.png, design-build6-dark.png and design-build6-timed-task.png.

Signed delivery run [39428455492](https://github.com/Maloletka777/LifePlanner/actions/runs/39428455492) explicitly passed Apple validation and upload. Separate App Store Connect API verification confirmed build 6 processing VALID, membership in the existing internal Owner Swift Testing group, and internalBuildState IN_BETA_TESTING. Builds 4 and 5 were intermediate uploads and were not assigned to that group. Public release was not performed.

The later c295e4f commit changes only the UI-test scroll helper, not application code; its additional validation run is 39429839161. The delivered app's own complete validation above is green. Source/core/database schema were unchanged by this visual restoration. The owner reported smooth operation of the previous native build; physical acceptance of this new design, larger text, landscape and Reduce Transparency remain pending. This does not claim complete parity with every historical TypeScript feature or any new data-science result.
