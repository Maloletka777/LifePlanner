import XCTest
@testable import PlannerCore

final class PlannerCoreTests: XCTestCase {
    let day = try! CalendarDay("2026-10-18")
    func makeHabit(mode: TrackingMode = .checkbox, target: Decimal = 1) throws -> (PlannerSnapshot, UUID) {
        var state = PlannerSnapshot(); var config = HabitConfiguration(name: "Read", from: day)
        config.tracking.mode = mode; config.tracking.target = target
        if mode == .quantity { config.tracking.unit = "pages" }
        let id = try state.createHabit(config); return (state, id)
    }
    func testRejectsImpossibleDates() throws {
        XCTAssertThrowsError(try CalendarDay("2025-02-29")); XCTAssertThrowsError(try CalendarDay("2026-04-31"))
        XCTAssertEqual(try CalendarDay("2024-02-29").description, "2024-02-29")
    }
    func testCivilArithmeticAcrossDST() throws {
        XCTAssertEqual(try CalendarDay("2026-03-28").adding(days: 2), try CalendarDay("2026-03-30"))
        XCTAssertEqual(try CalendarDay("2026-10-24").distance(to: CalendarDay("2026-10-26")), 2)
        XCTAssertEqual(day.isoWeekday, 7)
    }
    func testMonthlyLastDayClamp() throws {
        var s = Schedule(); s.kind = .monthly; s.monthDay = 31
        XCTAssertNotNil(try s.occurrence(on: CalendarDay("2026-02-28")))
        XCTAssertNil(try s.occurrence(on: CalendarDay("2026-02-27")))
    }
    func testYearlyLeapDayClampAndInvalidMonthDay() throws {
        var s = Schedule(); s.kind = .yearly; s.monthNumber = 2; s.monthDay = 29
        XCTAssertNotNil(try s.occurrence(on: CalendarDay("2025-02-28")))
        s.monthNumber = 4; s.monthDay = 31; XCTAssertThrowsError(try s.validate())
    }
    func testEveryNDaysDoesNotScheduleBeforeAnchor() throws {
        var s = Schedule(); s.kind = .everyNDays; s.anchor = day; s.intervalDays = 2
        XCTAssertNil(try s.occurrence(on: day.adding(days: -2)))
        XCTAssertNotNil(try s.occurrence(on: day.adding(days: 2)))
        XCTAssertNil(try s.occurrence(on: day.adding(days: 1)))
    }
    func testWeekdaySelectionAndWeeklySchedule() throws {
        var s = Schedule(); s.kind = .selectedWeekdays; s.weekdays = [7]
        XCTAssertNotNil(try s.occurrence(on: day)); XCTAssertNil(try s.occurrence(on: day.adding(days: 1)))
        s.kind = .weekly; s.weekday = 7; XCTAssertNotNil(try s.occurrence(on: day))
    }
    func testFlexiblePeriodBoundaries() throws {
        var s = Schedule(); s.kind = .timesPerWeek; s.weekStart = 1
        XCTAssertEqual(try s.occurrence(on: day), try .period(start: CalendarDay("2026-10-12"), endExclusive: CalendarDay("2026-10-19"), target: 3))
        s.kind = .timesPerMonth
        XCTAssertEqual(try s.occurrence(on: day)?.range, try DayRange(start: CalendarDay("2026-10-01"), endExclusive: CalendarDay("2026-11-01")))
        s.kind = .timesPerYear; XCTAssertEqual(try s.occurrence(on: day)?.range.endExclusive, try CalendarDay("2027-01-01"))
    }
    func testMissingIsNotExplicitFailureOrAvoidanceSuccess() throws {
        var (s, id) = try makeHabit(mode: .avoidance)
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .missing)
        try s.record(habitID: id, on: day, value: .boolean(false), boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .unsuccessful)
        try s.record(habitID: id, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .success)
    }
    func testDecimalAccumulationIsExact() throws {
        var (s,id) = try makeHabit(mode: .quantity, target: Decimal(string: "0.3")!)
        try s.record(habitID: id, on: day, value: .amount(Decimal(string: "0.1")!), boundary: day)
        try s.record(habitID: id, on: day, value: .amount(Decimal(string: "0.2")!), boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day).actual, Decimal(string: "0.3"))
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .success)
    }
    func testCorrectionVoidAndNoBranching() throws {
        var (s,id) = try makeHabit(mode: .counter, target: 10)
        try s.record(habitID: id, on: day, value: .amount(9), boundary: day)
        let root = s.observations[0].id
        try s.record(habitID: id, on: day, value: .amount(10), supersedes: root, boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day).actual, 10)
        XCTAssertThrowsError(try s.record(habitID: id, on: day, value: .amount(11), supersedes: root, boundary: day))
        try s.record(habitID: id, on: day, value: .void, supersedes: s.observations.last!.id, boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .missing)
        XCTAssertEqual(s.observations.count, 3); try s.validate()
    }
    func testAsOfDoesNotUseLaterCorrection() throws {
        var (s,id) = try makeHabit()
        try s.record(habitID: id, on: day, value: .boolean(false), boundary: day)
        s.observations[0].recordedAt = Date(timeIntervalSince1970: 100)
        try s.record(habitID: id, on: day, value: .boolean(true), supersedes: s.observations[0].id, boundary: day)
        s.observations[1].recordedAt = Date(timeIntervalSince1970: 200)
        XCTAssertEqual(try s.status(habitID: id, on: day, asOf: Date(timeIntervalSince1970: 150)).outcome, .unsuccessful)
    }
    func testSkippedExcludedAndFutureRejected() throws {
        var (s,id) = try makeHabit()
        try s.record(habitID: id, on: day, value: .skipped, boundary: day)
        XCTAssertFalse(try s.status(habitID: id, on: day).included)
        XCTAssertNil(try s.progress(on: day))
        XCTAssertThrowsError(try s.record(habitID: id, on: day.adding(days: 1), value: .boolean(true), boundary: day))
    }
    func testCounterRejectsFractionalAmountAndMismatchedType() throws {
        var (s,id) = try makeHabit(mode: .counter)
        XCTAssertThrowsError(try s.record(habitID: id, on: day, value: .amount(Decimal(string: "0.5")!), boundary: day))
        XCTAssertThrowsError(try s.record(habitID: id, on: day, value: .boolean(true), boundary: day))
    }
    func testHistoricalEditsPreserveOldTarget() throws {
        var (s,id) = try makeHabit(mode: .counter, target: 10)
        try s.record(habitID: id, on: day, value: .amount(10), boundary: day)
        var new = s.habits[0].configurations[0]; new.tracking.target = 20
        XCTAssertThrowsError(try s.editHabit(id, configuration: new, effectiveFrom: day))
        try s.editHabit(id, configuration: new, effectiveFrom: day.adding(days: 1))
        XCTAssertEqual(try s.status(habitID: id, on: day).credit, 1)
        XCTAssertEqual(s.habits[0].configuration(on: try day.adding(days: 1))?.tracking.target, 20)
        try s.validate()
    }
    func testArchiveRestoreEffectiveDates() throws {
        var (s,id) = try makeHabit()
        try s.setArchived(id, archived: true, from: day.adding(days: 1))
        try s.setArchived(id, archived: false, from: day.adding(days: 2))
        XCTAssertEqual(try s.status(habitID: id, on: day, boundary: day).outcome, .missing)
        XCTAssertEqual(try s.status(habitID: id, on: day.adding(days: 1), boundary: day.adding(days: 2)).outcome, .notScheduled)
        XCTAssertEqual(try s.status(habitID: id, on: day.adding(days: 2), boundary: day.adding(days: 2)).outcome, .missing)
    }
    func testRelationshipCycleRejectedWithoutMutating() throws {
        var (s,a) = try makeHabit(); let b = try s.createHabit(HabitConfiguration(name: "B", from: day))
        try s.addRelationship(Relationship(parentID: a, childID: b, kind: .subhabit, from: day))
        XCTAssertThrowsError(try s.addRelationship(Relationship(parentID: b, childID: a, kind: .subhabit, from: day)))
        XCTAssertEqual(s.relationships.count, 1)
    }
    func testFollowUpBlockedUntilParentSucceeds() throws {
        var (s,a) = try makeHabit(); let b = try s.createHabit(HabitConfiguration(name: "B", from: day))
        try s.addRelationship(Relationship(parentID: a, childID: b, kind: .followUp, from: day))
        XCTAssertEqual(try s.status(habitID: b, on: day).outcome, .blocked)
        try s.record(habitID: a, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.status(habitID: b, on: day).outcome, .missing)
    }
    func testPrerequisiteBlocksParent() throws {
        var (s,a) = try makeHabit(); let b = try s.createHabit(HabitConfiguration(name: "B", from: day))
        try s.addRelationship(Relationship(parentID: a, childID: b, kind: .prerequisite, from: day))
        XCTAssertEqual(try s.status(habitID: a, on: day).outcome, .blocked)
        try s.record(habitID: b, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.status(habitID: a, on: day).outcome, .missing)
    }
    func testRoutineStepsKeepOwnScheduleAndDeriveParent() throws {
        var (s,p) = try makeHabit(); let a = try s.createHabit(HabitConfiguration(name: "A", from: day)); let b = try s.createHabit(HabitConfiguration(name: "B", from: day))
        try s.addRelationship(Relationship(parentID: p, childID: a, kind: .routineStep, from: day, order: 0))
        try s.addRelationship(Relationship(parentID: p, childID: b, kind: .routineStep, from: day, order: 1))
        XCTAssertEqual(try s.status(habitID: b, on: day).outcome, .missing)
        try s.record(habitID: b, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.status(habitID: p, on: day).credit, Decimal(string: "0.5"))
        XCTAssertThrowsError(try s.record(habitID: p, on: day, value: .boolean(true), boundary: day))
        try s.record(habitID: a, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.status(habitID: p, on: day).outcome, .success)
    }
    func testRecursiveDeletionRequiresExplicitChoice() throws {
        var (s,a) = try makeHabit(); let b = try s.createHabit(HabitConfiguration(name: "B", from: day))
        try s.addRelationship(Relationship(parentID: a, childID: b, kind: .subhabit, from: day))
        XCTAssertThrowsError(try s.deleteHabit(a, includingDescendants: false))
        try s.deleteHabit(a, includingDescendants: true); XCTAssertTrue(s.habits.isEmpty); XCTAssertTrue(s.relationships.isEmpty)
    }
    func testChecklistClosureAndRoundTrip() throws {
        var (s,id) = try makeHabit(); s.habits[0].configurations[0].closesByChecklist = true
        var item = ChecklistItem(habitID: id, text: "Prepare", from: day); item.checkedDays.insert(day); s.checklist = [item]
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .success)
        let decoded = try PlannerSnapshot.decode(s.encoded())
        XCTAssertEqual(try decoded.status(habitID: id, on: day).outcome, .success)
    }
    func testFlexibleTargetCountsDaysNotMeasurements() throws {
        var (s,id) = try makeHabit(); s.habits[0].configurations[0].schedule.kind = .timesPerWeek
        s.habits[0].configurations[0].schedule.targetCount = 2
        try s.record(habitID: id, on: day, value: .boolean(true), boundary: day)
        try s.record(habitID: id, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day).periodSuccesses, 1)
    }
    func testGrowthRestartClosesPreviousAttempt() throws {
        var (s,id) = try makeHabit()
        try s.restartGrowth(habitID: id, on: day, cue: "After coffee", enjoyment: "yes")
        try s.restartGrowth(habitID: id, on: day.adding(days: 3), cue: "", enjoyment: "")
        XCTAssertEqual(s.attempts[0].endExclusive, try day.adding(days: 3)); try s.validate()
    }
    func testReminderPlanFutureSortedAndBudgeted() throws {
        var (s,id) = try makeHabit(); s.habits[0].configurations[0].schedule.timezone = "Europe/London"
        s.reminders.append(Reminder(habitID: id, minute: 9*60))
        let now = ISO8601DateFormatter().date(from: "2026-10-18T09:30:00Z")!
        let plan = try s.reminderPlan(now: now, horizonDays: 30, limit: 4)
        XCTAssertEqual(plan.count, 4); XCTAssertTrue(plan.allSatisfy { $0.fireAt > now })
        XCTAssertEqual(CalendarDay(date: plan[0].fireAt, timezone: TimeZone(identifier: "Europe/London")!), try day.adding(days: 1))
    }
    func testImportRejectsCorruptReferencesAndUnknownFormat() throws {
        var (s,id) = try makeHabit(); s.reminders.append(Reminder(habitID: UUID(), minute: 10))
        XCTAssertThrowsError(try PlannerSnapshot.decode(s.encoded()))
        s.reminders = []; s.formatVersion = 2; XCTAssertThrowsError(try s.validate())
        XCTAssertNotEqual(id, UUID())
    }
    func testArchivedParentRemovesInheritedOccurrence() throws {
        var (s,parent) = try makeHabit(); let child = try s.createHabit(HabitConfiguration(name: "Dependent", from: day))
        try s.addRelationship(Relationship(parentID: parent, childID: child, kind: .followUp, from: day))
        try s.setArchived(parent, archived: true, from: day)
        XCTAssertEqual(try s.status(habitID: child, on: day).outcome, .notScheduled)
    }
    func testWeightedProgressUsesHistoricalImportance() throws {
        var (s,first) = try makeHabit()
        s.habits[0].configurations[0].importance = .critical
        _ = try s.createHabit(HabitConfiguration(name: "Second", from: day))
        try s.record(habitID: first, on: day, value: .boolean(true), boundary: day)
        XCTAssertEqual(try s.progress(on: day, boundary: day), Decimal(string: "0.5"))
        s.weightedProgress = true
        let weighted = try XCTUnwrap(s.progress(on: day, boundary: day))
        XCTAssertEqual(NSDecimalNumber(decimal: weighted).doubleValue, 2.0/3.0, accuracy: 1e-12)
    }
    func testAtMostNeedsExplicitReportIncludingZero() throws {
        var (s,id) = try makeHabit(mode: .counter, target: 3)
        s.habits[0].configurations[0].tracking.comparison = .atMost
        XCTAssertEqual(try s.status(habitID: id, on: day).outcome, .missing)
        try s.record(habitID: id, on: day, value: .amount(0), boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day, boundary: day).outcome, .provisional)
        XCTAssertEqual(try s.status(habitID: id, on: day, boundary: day.adding(days: 1)).outcome, .success)
        try s.record(habitID: id, on: day, value: .amount(4), boundary: day)
        XCTAssertEqual(try s.status(habitID: id, on: day, boundary: day.adding(days: 1)).outcome, .unsuccessful)
    }
}
