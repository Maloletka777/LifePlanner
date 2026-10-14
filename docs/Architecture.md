# Architecture of the review copy

This description follows LifePlanner 0.5.9 source rather than earlier design proposals.

Expo Router files in `app/` compose the screens. The root layout installs theme, database and Planner providers. User actions flow from presentation to application use cases, repository contracts and SQLite adapters.

## Main layers

- `src/features/planner/domain/`: scheduling, tracking, observations, progress and validation.
- `application/`: creation/editing, lifecycle, observations, reminders, growth and analytics use cases.
- `repositories/`: persistence contracts.
- `infrastructure/`: SQLite, notifications, clocks and identifiers.
- `presentation/`: screens, interaction state and view models.
- `src/ui/`: shared themes, motion and interface components.

`src/core/database/migration-runner.ts` registers migrations 001–015; `schema-expectations.ts` specifies the expected database shape. The canonical database is `lifeplanner.db`. Old migrations are required to upgrade existing installations. Migration 015 adds growth attempts, not machine learning.

The growth, awards and feedback modules calculate results using explicit rules. A future predictive module should have a separate testable interface and use only data available at prediction time. Model training should remain separate from the mobile UI.

Persistence tests use Node's SQLite implementation. Some UI regressions inspect source files instead of rendering screens. Bundle export checks packaging, not native installation or physical-device behaviour.

Historical architecture, schema notes, decisions and prototypes remain in the local cleanup archive outside this publication folder; their claims may describe earlier versions.
