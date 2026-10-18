# Functional parity audit

Baseline: TypeScript commit `62df10e`. Initial Swift baseline: `7f56a1d`.
Audit started after the owner authorised completing the migration. A passing build is not the completion criterion.

## Evidence levels

**Active** means an operation is connected to production code/screens. **Model only** means a calculation is present but no production caller was found. **Schema/design only** means tables or a design requirement exist without a running operation. These states must not be reported as equivalent.

| Area | Evidence in original | Initial Swift finding | Acceptance criterion |
|---|---|---|---|
| Ordinary subhabits and routine containers | `application/occurrence/get-planner-occurrences-for-date.ts`, `domain/ordinary/ordinary-completion-role.ts` | **Incorrect:** routine steps were ordered gates with inherited schedules | Each step keeps its own schedule; parent derives unweighted mean of applicable step credits; nested containers work; no independent parent completion |
| Routine conversion | `application/ordinary-subhabit/routine-conversion.ts`, production factory in `index.ts` | Missing | Dated preview and conversion, direct organizational children only, exclude conditional links, reject parent facts at/after boundary, preserve earlier structure |
| Reparent/detach | `application/ordinary-subhabit/change-ordinary-parent.ts` | Direct link/unlink only | Effective-date changes, retained old relationships and rejection of cycles/mode conflicts |
| Observation corrections | `application/observation/correct-habit-observation.ts` | Same-day only | Value/date/time correction, single leaf, original retained, old date loses moved contribution, target date validates schedule/type |
| Detached observation context | schema and observation SQLite adapter | Context not retained | Store immutable configuration/relationship context when a fact is recorded, allow same-occurrence correction after unlink/archive, retain history through reload |
| Checklist closure | `application/checklist/habit-checklist-commands.ts` | Computed UI state only | Closing/reopening from checklist must also be an observation; no independent manual control when checklist owns closure |
| Checklist removal | effective `created_from`/`deleted_from` and per-day ticks | Could erase ticks when removing from a past date | No implicit erasure of historical tick facts; reject destructive backdating or retain explicit audit history |
| Growing lifecycle | `application/growth/habit-growth-commands.ts`, `domain/values/day-block.ts` | Restart only; no stop, cap or typed enjoyment | Start/stop/restart preserve attempts; maximum three concurrent attempts; cue/enjoyment editing validated |
| Growing calculations/awards | `routine-growth-model.ts`, `routine-awards-model.ts` | Main rules ported | Compare inherited examples and keep earned awards; do not count unfinished current day as failure |
| Diagnostic patterns | `routine-diagnosis-model.ts`; no production caller outside that file found | Missing pure model and UI | Port all five rule models with inherited thresholds; explicit evidence/time fields; new UI wiring documented as new implementation, not a restored old screen |
| Daily Focus | `migrations/001-planner-core.ts`, archived `docs/Features.md` section Daily Focus; no application operations found | Simple journal text | One active focus per date, checklist, provenance, pin/copy/extend/archive/convert and searchable history; these implement a previously specified schema/design |
| Scheduling | nine legacy schedule types | Basic implementation tested | Fixed and flexible windows, partial-history boundaries, context/date changes and independent version compatibility checked |
| Progress/analytics | legacy exact progress and occurrence read model | Simplified descriptive chart | Correct routine-container/child accounting and flexible-period windows; no fabricated ML interpretation |
| Reminders | native gateway/reconciliation in original Expo adapter | New UserNotifications adapter | Correct eligible dates/targets/dependencies, reconciliation and permission denial; physical delivery remains a device gate |
| Native backup | original app has SQLite migrations, no populated device DB provided | New native JSON backup | Old native backups remain readable as fields are added; SQLite transaction/revision and pre-restore safety verified |
| Existing personal records | Owner confirmed all app files were already supplied and no database history is expected | No legacy app database found in supplied folders | Fresh native database is appropriate. Do not block functional migration on a nonexistent export; any future imported database needs its own preview/validation |
| Visual behaviour | old native-looking custom React UI | Standard SwiftUI replacement | Explicitly document differences; verify important flows on simulator and then physical iPhone. No pixel-identical claim |
| Apple Watch / sync / HealthKit | Future scope | Future scope | Not required to claim parity with the original app; do not imply implemented |
| Data Science | Proposal only | Proposal only | No dataset processing or model integration during this stage |

## Completion gates

1. Source-derived domain differences fixed with executable behavioural regressions.
2. Missing accepted operations connected to the native screens; old/native storage remains readable.
3. Domain/storage suites and both Apple builds pass at the actual final source commit; simulator flows cover changed features, not only the old two smoke tests.
4. Fresh installation, restart, backup/restore, accessibility, keyboards, time zones and reminders verified on real iPhone. A physical-device result cannot be invented by a simulator test.

No overall completion percentage is assigned. The earlier 38 tests establish only their stated cases; one of them encoded the wrong routine-step semantics and must be replaced rather than preserved as a false requirement.
