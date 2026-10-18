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

## Acceptance still required

- The source revision and automated acceptance must be read with their exact runs above. Broader UI flows and physical devices still require the following checks.
- Install a signed candidate beside the existing iPhone app; confirm no original database/container is affected.
- Create/edit all schedule and tracking variants, archived/future habits, tasks and checklists; reload and restore backup after restart.
- Check notification permission denial, scheduling, delivery, travel/DST, disabled reminders and app inactivity beyond the 30-day horizon. The planner reconciles on activation and edits; indefinite background refresh is not implemented.
- Check VoiceOver labels, Dynamic Type, dark mode, small screens, keyboards, date/time zones, Mac keyboard navigation and window resizing.
- Compare inherited advanced semantics against legacy fixtures before claiming full parity or importing real history. See `MIGRATION.md` for known differences.
- Measure responsiveness and database size with realistic large histories. The current aggregate storage and repeated per-day calculations are intentionally simple and have no scalability claim.

No App Store/TestFlight release, physical-iPhone usability acceptance, Watch app, inter-device sync, trained model or behavioural-effectiveness trial has been performed.
