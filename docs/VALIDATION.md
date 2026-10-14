# Review-copy validation

Preparation date: 14 October 2026. Runtime: Node.js 24.19.0.

Baseline before cleanup: 943 tests passed, 0 failed.

## Results after cleanup

| Check | Result |
| --- | --- |
| `npm test` | 943 passed, 0 failed, 0 skipped |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed, no warnings/errors reported |
| `npx expo config --type public` | Passed; version 0.5.9/build 40 |
| `npx expo export --platform ios` | Passed; Hermes bundle and assets exported |
| `npx expo install --check` | Warning/failure: Expo recommends `expo ~54.0.37` and `expo-constants ~18.0.14`; lockfile contains 54.0.36 and 18.0.13 |

The two dependency versions also exist in the archived pre-cleanup lockfile. They were retained to keep cleanup separate from a dependency upgrade. The compatibility check is therefore **not fully green**, despite passing tests, types, lint and iOS bundle export. No physical iPhone test or App Store build was performed.

Dependencies were installed from the lockfile using npm 12.2.0. That npm version reported blocked postinstall scripts for esbuild and unrs-resolver; the subsequent checks above nevertheless completed successfully. The project does not require npm 12 specifically.

## Retained historical fixtures

- `UIV0321PhysicalIPhoneChecklist.md` is read by `test/ui/ui-v0321-candidate.test.ts`.
- `DayTransitionAnimation.md` is read by `test/planner/ui/day-journal.cases.ts`.

Both were preserved unchanged for existing regression checks. They are historical records, not current physical-device acceptance results.

## Cleanup scope

Historical documentation, prototypes, agent/editor settings, unused starter helpers and the destructive reset script were archived outside the application. The active navigation helper, implementation, migrations and tests were retained. Package metadata was aligned with the existing app version 0.5.9; dependency versions were not intentionally changed.

Automated checks cannot establish iPhone appearance, touch behaviour, notification delivery or retention of a real user's device database. Some inherited UI assertions check source text instead of behaviour. Physical-device verification remains separate.
