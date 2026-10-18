# Validation record

## Local Windows checks

Swift 6.4.1, Visual Studio 2022 Build Tools 17.14, x64 Windows SDK. `tools/test-windows.ps1` builds the actual package, the vendored SQLite C library, PlannerCore and PlannerStorage and executes XCTest suites.

Latest local result: **38 tests passed, zero failures** — 28 planner domain tests, 4 growth-rule tests and 6 SQLite persistence tests. The exact output is retained in `windows-test-results.txt`. Swift's separate new Testing runner reports zero tests because these suites use XCTest; that is not the total suite count. A Windows warning about an optional `.build/debug` symbolic link did not prevent builds/tests.

Coverage includes civil/DST dates, clamped month/leap dates, weekday/interval/flexible periods, missing/false/avoidance distinction, exact decimal accumulation, corrections and voids, future rejection, historic configuration edits, lifecycle boundaries, cycles, prerequisites/follow-ups/routine order, recursive deletion, checklist closure, growth interruption/recovery/awards, reminder plan bounds, reopen/persistence, stale writers, invalid import, safety backup and corrupt-file preservation.

All `AppleApp/*.swift` files were also parsed by the compiler on Windows. Parsing is not SwiftUI type checking or execution.

## Apple build evidence

GitHub Actions workflow: `Native Swift validation`, branch `swift-migration`.

- [Run 39130388765](https://github.com/Maloletka777/LifePlanner/actions/runs/39130388765), commit `284e444`: package tests passed; iOS compilation found the notification concurrency issue.
- [Run 39130564349](https://github.com/Maloletka777/LifePlanner/actions/runs/39130564349), commit `6536b74`: package tests and iOS simulator build passed; macOS build found the debug architecture mismatch.
- Later run results must be read from the workflow and recorded here before claiming overall Apple validation.

Xcode 16.4 / Apple Swift 6.1.2 were reported by the first runners. Native package supports Swift tools 6.0 and does not require the newer Windows compiler's language features.

## Acceptance still required

- Final successful iOS and Mac builds for the current code; simulator UI tests and retained screenshots/results.
- Install a signed candidate beside the existing iPhone app; confirm no original database/container is affected.
- Create/edit all schedule and tracking variants, archived/future habits, tasks and checklists; reload and restore backup after restart.
- Check notification permission denial, scheduling, delivery, travel/DST, disabled reminders and app inactivity beyond the 30-day horizon. The planner reconciles on activation and edits; indefinite background refresh is not implemented.
- Check VoiceOver labels, Dynamic Type, dark mode, small screens, keyboards, date/time zones, Mac keyboard navigation and window resizing.
- Compare inherited advanced semantics against legacy fixtures before claiming full parity or importing real history. See `MIGRATION.md` for known differences.
- Measure responsiveness and database size with realistic large histories. The current aggregate storage and repeated per-day calculations are intentionally simple and have no scalability claim.

No App Store/TestFlight release, physical-iPhone usability acceptance, Watch app, inter-device sync, trained model or behavioural-effectiveness trial has been performed.
