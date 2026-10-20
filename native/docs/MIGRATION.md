# Migration record — 18 October 2026

## Baseline and preservation

Baseline: LifePlanner 0.5.9 Alpha / iOS build 40, Expo SDK 54, React Native, TypeScript, SQLite migrations 001–015. Published baseline commit: `62df10e`. The original name in the source is LifePlanner; the owner currently calls the product Live Planner. Existing production identifiers have not been reused.

Two independent ZIP snapshots were made before migration:

| Snapshot | Files | ZIP bytes | Verification |
|---|---:|---:|---|
| Published TypeScript source, including local Git history | 752 | 3,604,964 | ZIP CRC and SHA-256 of every archived file |
| Summer original on Google Drive, including documentation and Git history | 1,031 | 176,664,025 | ZIP CRC and SHA-256 of every archived file |

Local archives and manifests are in the sibling `LivePlanner-Backups-2026-10-18` folder, outside GitHub. Regenerable `node_modules`, `.expo` and `dist` were excluded. External research datasets remain in their original research folder; they were not part of these source archives. Device databases were not available. An interrupted zero-byte ZIP from initial enumeration is labelled `summer-original-interrupted.zip`; it is not a backup and is not used for restoration.

## Architecture

`PlannerCore` is Foundation-only. `PlannerStorage` stores one validated aggregate in a separate SQLite database. `AppleApp` renders native SwiftUI and adapts UserNotifications. `AppleUITests` drives actual simulator controls. Two Xcode targets share the same UI and package; no Watch target is claimed.

The owner selected Swift to enable native Apple development. This is an engineering rationale; TypeScript itself is not an academic defect. Language choice alone neither establishes novelty nor makes a project Data Science.

## Functional coverage and intentional differences

| Baseline capability | Native candidate |
|---|---|
| Today and date navigation | Native date picker, previous/next day, day blocks, planned time/duration |
| One-day tasks and journal | Create/edit, completion, archive/restore, checklist, daily focus and notes |
| Habits | Create/edit, categories, symbol/colour, importance, archive/restore, confirmed recursive deletion |
| Nine schedule types | Daily, selected weekdays, every N days, weekly, monthly, yearly, flexible weekly/monthly/yearly targets |
| Five tracking modes | Checkbox, avoidance, counter, decimal quantity and duration seconds |
| Historical settings | Effective-dated complete configurations; earlier versions retained |
| Corrections | Append-only value correction/void with single-leaf validation; UI exposes history |
| Relations | Ordinary subhabit, prerequisite, follow-up, independently scheduled routine steps, derived parent completion, dated conversion/reparent/unlink and cycle rejection |
| Checklists | Per-occurrence checked days and optional checkbox closure |
| Progress | Equal/importance weights and partial at-least numeric credit; explicit skip exclusion |
| Growing | Attempts, cues, enjoyment, inherited continuity/interruption/return rules and four supported award axes; optimisation remains empty without accepted-suggestion facts |
| Analytics | Descriptive last-30-day chart and separate missing/unsuccessful reporting |
| Reminders | Native permission request and bounded reconciliation; permission/delivery require device verification |
| Backup/restore | Validated native JSON, pre-restore safety file, SQLite revision protection |

This is a functional rewrite, not a line-by-line preservation of every old experimental surface. Known differences that must stay visible:

- The old custom animated date strip, liquid transitions, plate layouts, detailed category palette and gestures are replaced with standard native controls. Visual parity has not been claimed.
- Schedule, tracking and identity history now share a complete configuration version instead of independent Expo version tables. Editing from a day already used by observations on the configuration's first day is rejected rather than rewriting history.
- Source audit corrected the initial routine implementation: steps have independent schedules and the parent derives their equal mean, rather than imposing ordered gates. Nested routines, selective dated conversion, reparenting and preserved detached observation context now have regression tests. See `PARITY-AUDIT.md` for evidence and remaining comparison boundaries.
- All five inherited diagnostic rule models are ported and connected to a new native review screen. No production caller for the old pure model was found. Native review opens the plan editor; automatically applying a suggested plan and optimisation awards based on accepted suggestions are not implemented. Thresholds are product rules, not validated behavioural science.
- Corrections can change date, optional actual time or value, or void a fact. Original facts and their captured configuration/relationship context remain in history; corrections cannot cross tracking-mode boundaries.
- Daily Focus now has dated cards, checklists, searchable history, pin/copy/extend/archive and idempotent conversion to a task. Original evidence was schema/design, not running application operations; successor/provenance behaviour is an explicit native implementation choice.
- Flexible schedules currently count distinct successful days toward the configured period target. The old resolver instead aggregates observations across its selected period before qualification; `periodTargetCount` was not used by that qualifier. This is a documented behavioural difference requiring a product decision before claiming exact legacy equivalence. Open daily numeric at-most results are provisional and excluded from progress.
- Native numeric recording accepts an explicit zero, unlike the old positive-only counter/duration delta validator. This distinguishes a reported zero from a missing report. Native decimal quantities also do not enforce the old per-target fixed scale. These are native input choices, not proven identical migrations.
- Native storage is a new schema; automatic conversion of a populated Expo database is not implemented. The owner confirmed no personal database history is available or expected, so this does not block the fresh native installation. Any later legacy import needs a separate reconciliation procedure.

## Legacy data acceptance procedure

This procedure applies only if legacy history is supplied later. The owner currently has no database to migrate.

1. Obtain an exported copy of the device database without uninstalling the old app. If WAL is active, export with SQLite's backup API or collect a consistent database/WAL pair.
2. Work only on a copy. Record SHA-256, schema version, table shape, row counts and corruption checks. Preserve the original file independently.
3. Build synthetic and de-identified fixtures covering all 15 migrations, configuration boundaries, detached contexts, correction chains, checklist ticks, ordinary parents, reminders and growth attempts.
4. Define mappings and explicit rejections for unsupported history. Compare old/new counts and per-occurrence results on the same boundary/time zone. Never silently flatten independent version histories or convert missing reports to failures.
5. Add an explicit import preview and reconciliation report, then test restore/rollback before using actual history. Until then the new app starts with its own empty store.

## Future Apple integration

Keep domain logic shared. A Watch app should use a deliberately designed sync/change protocol with stable IDs, tombstones, revisions and conflict resolution; copying whole SQLite files between devices is unsuitable. Add WatchConnectivity and a small offline action queue only when this is scoped. HealthKit requires purpose-specific permissions, unit/time-zone mapping and an explicit distinction between sensor evidence and self-reports. macOS/iOS sharing via CloudKit or another service needs a separate design and consent decision. None was added during migration.
