## Verified corrected delivery: 0.1.0 (9), 20 October 2026

Reference: final published TypeScript 0.5.9 / iOS build 40, commit 62df10e. Delivered Swift source **507d393a7de619c02d43b70c730a0e4797c39bb4**. [Validation run 39443649894](https://github.com/Maloletka777/LifePlanner/actions/runs/39443649894) completed successfully: **57 core/storage tests and all eight UI scenarios**, iPhone simulator build, macOS build and unsigned Release archive. The new explicit-block scenario passes creation in Morning, collapse/reopen and persistence after relaunch. UTF-8 checklist labels and existing completion workflows pass.

[Signed run 39443662539](https://github.com/Maloletka777/LifePlanner/actions/runs/39443662539) explicitly returned VERIFY SUCCEEDED and UPLOAD SUCCEEDED. Artifact 12273744210 is signed-iphone-9. Separate App Store Connect API verification confirmed build 9 processing VALID, membership in the existing Owner Swift Testing internal group and internalBuildState IN_BETA_TESTING. Builds 7 and 8 were intermediate uploads and were not assigned. Build 6 remains historical and was rejected as the wrong design reference. No public App Store release.

Final simulator screenshots from artifact 12276371792, iPhone 17 Pro/iOS 26.2, are images/design-build9-day-journal.png, design-build9-dark.png and design-build9-empty-day.png. Visually checked graphite light/true-black dark, four tabs, compact plates and correct Morning placement. Screenshots contain test records. Physical-device acceptance and larger text/landscape/Reduce Transparency checks remain pending.

No Swift core, storage or schema changes from the pre-correction source. Existing native functional scope is retained; this is a native adaptation of the final visual language, not a claim of full historical TypeScript feature/animation parity. The custom calendar lens and Overview folder animation are not replicated. No datasets or predictive models were added.

Rollback source/views archive: LivePlanner-Swift-before-v059-design.zip, SHA256 77977f01de464c9e21132142720cc1608887f481888bdc06010e5baf01ad81e1, integrity verified and excludes signing material.

## Earlier records (superseded where noted)

# Corrected design reference: LifePlanner 0.5.9 / iOS build 40

20 October 2026: the owner rejected Swift build 6 because it restored a much older screenshot. The authoritative reference is the last published TypeScript application, commit 62df10e (14 October), package/app version 0.5.9 and iOS build 40. README.md, app.json, active routes and src/ui/theme/color-themes.ts establish this independently. The warm screenshot is withdrawn as a design reference.

The Swift correction uses the source graphite light/dark tokens, white/charcoal 12-point plates with 8-point gaps, solid category marks, independent completion green and priority colours. Tabs are Today, Growth, Overview, More. Today is a Day Journal grouped by stored Anytime/Morning/Afternoon/Evening, never assigned by clock time. Adding from a block presets that block in the native editor. Collapsible sections retain editing, checklists and history. The old full-day hour rail is removed. System TabView, navigation, sheets and date pickers retain native interaction and Liquid Glass where supported. Swift storage/core/schema are unchanged.

This is a native adaptation of the active source. Source-specific custom lens/calendar and overview folder animations are not claimed to be reproduced. Existing native functional scope remains documented separately. No data-science work is added.

Rollback before this correction: LivePlanner-Swift-before-v059-design.zip (views/tests/documentation; no signing keys). Validation/delivery evidence will follow the corrected candidate checks.

## Superseded build 6 restoration record

# Native design restoration â€” 20 October 2026

The owner requested restoration of the earlier visual identity while retaining the Swift implementation and native Apple interactions. Reference: the owner's original calendar screenshot (sand ground, cream calendar, forest-green selection and Today / Overview / More navigation). The cleaned TypeScript source currently contains a later graphite theme; it is not treated as authoritative for the requested warm palette.

Light tokens sampled from the reference: ground #EAD6B3, calendar #FAF2E7, header #F4E7D4. A dark counterpart follows system appearance. Text remains system typography with Dynamic Type; semantic SF Symbols replace custom imitation controls.

Restored the week date rail, day arrows/date picker, daily time rail, empty-day action, scheduled item cards and three-tab structure. Items without a planned time stay in Anytime; scheduled items appear within their recorded hour, merged and sorted chronologically across habits and tasks. Hour rows expand to fit content and accessibility sizes, rather than allowing colliding absolute-position cards. The current-hour marker refreshes every minute. This is an hour-grouped agenda, not a duration-proportional calendar or a drag-to-reschedule implementation.

Native TabView, NavigationStack, menus, forms, pickers and sheets retain system interactions and system Liquid Glass on supported OS releases. Only the floating add control explicitly uses glassEffect, guarded for iOS/macOS 26, with regular material on older supported systems. The date selection animation respects Reduce Motion. Reading surfaces remain opaque. Settings, archive/restore, routine conversion, history, observations and storage operations are retained; no database migration is introduced.

Rollback: verified local source archive LivePlanner-Swift-before-design-2026-10-20.zip, SHA256 b8e44af6d1fc91ba0ed68233bcd6ce66e15d8b3326339af73ddc3219dc125679. Previously delivered source is 2d58491 (TestFlight 0.1.0 build 3); the pre-design documentation head is 14248b2.

Validation: retain the five persistence/behaviour scenarios and add tests for Today / Overview / More, habit management, Growing, backups, timed task persistence, empty-day navigation and light/dark captures. Run 39425315415 (14c5ee4) passed 57 package tests, both Apple builds/archive and all seven UI tests after correcting task queries to accommodate native accessibility element types. The intermediate 18c314d run exposed a test scrolling overshoot; the final app source and verified delivery are recorded below. Physical-device visual acceptance, larger text, landscape and Reduce Transparency remain to be checked. No new data-science result is claimed.

The first captured dark screenshot remained light because the standard launch preference was not applied. A Debug-only launch flag now explicitly selects dark appearance for this screenshot test. Release builds ignore the test override and follow system appearance. Visual review also reduced the empty rail to the reference's compact full-day scale; rows with items still expand for content.

Apple reference: https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass


## Verified delivery â€” 20 October 2026

Restored design delivered as **0.1.0 (6)**, app source `f8a05991842d6e71038875536517c8582e87417a`. Validation run [39428457294](https://github.com/Maloletka777/LifePlanner/actions/runs/39428457294) completed successfully: 57 core/storage tests, all seven UI scenarios, iPhone simulator and macOS builds, and unsigned Release archive. Screenshot evidence is from artifact 12268047156 on iPhone 17 Pro; see images/design-build6-empty-day.png, design-build6-dark.png and design-build6-timed-task.png.

Signed delivery run [39428455492](https://github.com/Maloletka777/LifePlanner/actions/runs/39428455492) explicitly passed Apple validation and upload. Separate App Store Connect API verification confirmed build 6 processing VALID, membership in the existing internal Owner Swift Testing group, and internalBuildState IN_BETA_TESTING. Builds 4 and 5 were intermediate uploads and were not assigned to that group. Public release was not performed.

The later c295e4f commit changes only the UI-test scroll helper, not application code; its additional validation run is 39429839161. The delivered app's own complete validation above is green. Source/core/database schema were unchanged by this visual restoration. The owner reported smooth operation of the previous native build; physical acceptance of this new design, larger text, landscape and Reduce Transparency remain pending. This does not claim complete parity with every historical TypeScript feature or any new data-science result.

The explicit-block UI assertion exposed stale state captured by the boolean SwiftUI creation sheet: Morning creation could still use Anytime. Candidate 507d393 binds sheet presentation to an identifiable request carrying the block. Validation 39443649894 and signed run 39443662539 now check this correction. Build 8 is withheld from the owner group, as was build 7. Earlier screenshots are intermediate evidence only.
