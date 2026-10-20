# Live Planner — native Swift migration

Native iPhone/iPad and macOS application using Swift 6, SwiftUI, Charts, UserNotifications and SQLite. The shared Swift package contains calendar/scheduling, tracking, observation corrections, historical configuration, lifecycle, relationships, growth rules, reminder planning and validated storage. No TypeScript or web view is needed to run the native application.

This is a migration candidate, not an accepted App Store release. Original Expo source remains in the parent repository while parity and device acceptance are checked. Data science is planned, not implemented.

## Open on a Mac

Open `LivePlanner.xcodeproj`. Select `LivePlanner` for iPhone/iPad or `LivePlannerMac` for macOS. Minimum targets are iOS 17 and macOS 14. Use Xcode 16 or later with a Swift 6 compiler. For a simulator build, no Apple account is needed. Device installation requires selecting your own signing team. The new development bundle identifier keeps this candidate separate from the existing Expo app and its database.

```sh
swift test
xcodebuild -project LivePlanner.xcodeproj -scheme LivePlanner -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project LivePlanner.xcodeproj -scheme LivePlannerMac -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
```

The GitHub Actions workflow also runs iPhone UI tests. See [validation](docs/VALIDATION.md) for observed results; a project file or a passing parser alone is not proof of an Apple build.

## Windows

The domain and SQLite package can be built and tested on Windows. `tools/test-windows.ps1` locates Swift and Visual Studio C++ build tools. SwiftUI requires Apple's SDK and is not a Windows UI. SQLite is vendored from its official distribution with verified provenance, so tests do not require a third-party database wrapper or package service.

## Data

The native SQLite file is `Application Support/LivePlannerNative/liveplanner-native.sqlite` inside the app's container. The canonical state is a validated versioned JSON aggregate inside a SQLite transaction, with an optimistic revision check. This deliberately simpler storage design rewrites the aggregate on each change; performance with large histories must be measured before claiming scalability.

Use Settings → Export backup for a portable native JSON backup. Restore validates the input and saves a fresh safety copy before replacing current state. Corrupt or unfamiliar databases produce an error instead of an empty planner.

The Expo `lifeplanner.db` has a different schema. Native backup import does **not** accept it. Do not uninstall the existing app or put the Expo database at the native path. See [migration scope](docs/MIGRATION.md).

## Documentation

- [Migration decisions and parity](docs/MIGRATION.md)
- [Source-derived functional audit](docs/PARITY-AUDIT.md)
- [Validation and device checklist](docs/VALIDATION.md)
- [Data science research/integration plan](docs/DATA-SCIENCE-PLAN.md)
- [Dissertation evidence and outline](docs/DISSERTATION-NOTES.md)
- [Development record](docs/DEVELOPMENT-LOG.md)
- [iPhone distribution without a personal Mac](docs/IPHONE-WITHOUT-MAC-RU.md)

Apple Watch, HealthKit, WatchConnectivity, App Intents, CloudKit, trained prediction and externally sourced user data are not implemented. The iPhone and Mac apps currently have separate local stores. Neither application claims to improve behaviour or infer habit automaticity.

The original application and this rewrite used AI assistance. Source availability does not establish that an AI-generated implementation or text may be submitted as independent student work. The course's authorship and disclosure requirements remain applicable. No application software licence has yet been selected. SQLite's licence is documented in `Vendor/SQLite/PROVENANCE.json`.
