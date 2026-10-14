# LifePlanner

An offline-first planner for tasks, habits and routines, built with Expo SDK 54, React Native, TypeScript and SQLite. This is the existing application baseline for a proposed data science dissertation.

**Version 0.5.9 Alpha — iOS build 40.** This is a development prototype. The data science module is not implemented or validated yet.

## Current application

The source includes a daily journal, calendar navigation, planned times and durations, habit/task creation and editing, archiving and restoration, observations and corrections, checklists, routine relationships, overview analytics and local reminders. The Growing view and its progress/awards/feedback modules use explicit rules, not machine learning. Their presence in the source does not establish physical-device acceptance of every feature.

Data is stored locally in `lifeplanner.db`. There is no backend, telemetry service or populated user dataset in this repository. Database migrations 001–015 are retained for compatibility with existing installations.

## Install and run

Use Node.js 22.13 or newer and npm. This review used Node.js 24.19.0; persistence tests depend on the built-in `node:sqlite` module.

```sh
npm ci
npm start
```

For a browser development preview:

```sh
npm run web
```

Native testing requires a compatible Expo development build on a device, or an iOS simulator on macOS. Native notification delivery and iPhone interaction require device testing. The browser preview is a development aid, not a substitute for native testing. Its SQLite implementation needs cross-origin isolation; the Metro development configuration supplies the relevant headers. Static web hosting would need equivalent configuration.

The Expo/EAS settings refer to the author's application and project. Local checks and bundle export do not publish to that account. Independent EAS builds/submissions require your own project configuration and signing credentials. Signing credentials are not included.

## Checks

```sh
npm test
npx tsc --noEmit
npm run lint
npx expo install --check
npx expo config --type public
npx expo export --platform ios
```

See [VALIDATION.md](docs/VALIDATION.md) for the results and limitations. Some inherited UI tests inspect source text; a passing suite is not proof of usability or visual correctness.

## Structure

```text
app/                         Expo Router routes
src/application/providers/   Startup and database providers
src/core/database/           SQLite, schema checks and migrations
src/features/planner/        Domain, use cases, persistence and presentation
src/ui/                      Shared theme and components
components/haptic-tab.tsx    Navigation helper
assets/                      Icons and splash assets
test/                        Domain, persistence and UI regression tests
docs/                        Architecture, research scope and validation
```

- [Architecture](docs/Architecture.md)
- [Proposed research and dataset sources](docs/RESEARCH.md)
- [Validation](docs/VALIDATION.md)

## Dissertation scope and provenance

The proposed research investigates recorded return to successful habit performance after an unsuccessful reporting period, especially with little user history. Dataset preparation, model training, evaluation and integration remain future work. Accuracy on an external dataset would not demonstrate that the app improves behaviour.

The existing application was developed with AI assistance. The pre-existing application, AI assistance and the student's subsequent research contribution should be distinguished in the dissertation according to university requirements.

Historical handoffs, design experiments, agent settings and unused starter files were archived locally outside this publication folder. Two historical documents remain because existing regression tests read them; they are not current device-acceptance reports.

External datasets are kept outside the application repository. Raw archives, device databases, local environment files, dependencies and generated builds are excluded from Git. See the research document for sources and dataset licence notes.

No software licence has been selected for the application. Dataset licences do not license this application's code.
