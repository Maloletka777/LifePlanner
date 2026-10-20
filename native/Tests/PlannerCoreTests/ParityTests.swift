import XCTest
@testable import PlannerCore

final class ParityTests: XCTestCase {
    let day = try! CalendarDay("2026-08-03")
    func state() throws -> (PlannerSnapshot, UUID) {
        var s = PlannerSnapshot(); let id = try s.createHabit(HabitConfiguration(name: "Parent", from: day))
        return (s,id)
    }
    func testBackdatedConfigurationEditRejectsWithoutMutatingRecordedHistory() throws {
        var (s,id) = try state()
        let recordedDay = try day.adding(days: 2)
        try s.record(habitID: id, on: recordedDay, value: .boolean(true))
        let original = s
        var replacement = s.habits[0].configurations[0]; replacement.name = "Changed"
        XCTAssertThrowsError(try s.editHabit(id, configuration: replacement, effectiveFrom: day.adding(days: 1)))
        XCTAssertEqual(s, original)
        try s.validate()
        try s.editHabit(id, configuration: replacement, effectiveFrom: recordedDay.adding(days: 1))
        try s.validate()
        XCTAssertEqual(try s.status(habitID: id, on: recordedDay).outcome, .success)
    }
    func testRoutineIgnoresStepNotScheduledAndDoesNotDoubleCountChildren() throws {
        var (s,p) = try state(); let a = try s.createHabit(HabitConfiguration(name: "A", from: day))
        var config = HabitConfiguration(name: "Tuesday", from: day); config.schedule.kind = .weekly; config.schedule.weekday = 2
        let b = try s.createHabit(config)
        try s.addRelationship(Relationship(parentID: p, childID: a, kind: .routineStep, from: day))
        try s.addRelationship(Relationship(parentID: p, childID: b, kind: .routineStep, from: day))
        try s.record(habitID: a, on: day, value: .boolean(true))
        let status = try s.status(habitID: p, on: day)
        XCTAssertEqual(status.applicableSteps, 1); XCTAssertEqual(status.outcome, .success)
        XCTAssertEqual(try s.progress(on: day), 1)
        XCTAssertEqual(try s.status(habitID: b, on: day).outcome, .notScheduled)
    }
    func testNestedRoutineDerivesCompletionWithoutParentFacts() throws {
        var (s,p) = try state(); let a = try s.createHabit(HabitConfiguration(name: "Inner", from: day)); let b = try s.createHabit(HabitConfiguration(name: "Leaf", from: day))
        try s.addRelationship(Relationship(parentID: p, childID: a, kind: .routineStep, from: day))
        try s.addRelationship(Relationship(parentID: a, childID: b, kind: .routineStep, from: day))
        try s.record(habitID: b, on: day, value: .boolean(true))
        XCTAssertEqual(try s.status(habitID: p, on: day).outcome, .success)
        XCTAssertEqual(s.observations.count, 1)
    }
    func testRoutineConversionPreviewProtectsEarlierObservations() throws {
        var (s,p) = try state(); let a = try s.createHabit(HabitConfiguration(name: "A", from: day))
        try s.addRelationship(Relationship(parentID: p, childID: a, kind: .subhabit, from: day))
        try s.record(habitID: p, on: day, value: .boolean(true))
        let before = s
        let preview = s.routineConversionPreview(parentID: p, from: day)
        XCTAssertFalse(preview.allowed); XCTAssertEqual(preview.earliestSafeDate, try day.adding(days: 1))
        XCTAssertThrowsError(try s.convertToRoutine(parentID: p, from: day)); XCTAssertEqual(s,before)
        try s.convertToRoutine(parentID: p, from: day.adding(days: 1))
        XCTAssertEqual(s.relationships.first { $0.effective.contains(day) }?.kind, .subhabit)
        XCTAssertEqual(s.relationships.first { $0.effective.contains(try! day.adding(days: 1)) }?.kind, .routineStep)
        XCTAssertEqual(try s.status(habitID: p, on: day).outcome, .success)
    }
    func testConversionExcludesConditionalChildrenAndSupportsSelection() throws {
        var (s,p) = try state(); let a = try s.createHabit(HabitConfiguration(name: "A", from: day)); let b = try s.createHabit(HabitConfiguration(name: "B", from: day)); let c = try s.createHabit(HabitConfiguration(name: "Conditional", from: day))
        try s.addRelationship(Relationship(parentID: p, childID: a, kind: .subhabit, from: day))
        try s.addRelationship(Relationship(parentID: p, childID: b, kind: .subhabit, from: day))
        try s.addRelationship(Relationship(parentID: p, childID: c, kind: .followUp, from: day))
        try s.convertToRoutine(parentID: p, childIDs: [a], from: day)
        XCTAssertEqual(s.relationships.first { $0.childID == a }?.kind,.routineStep)
        XCTAssertEqual(s.relationships.first { $0.childID == b }?.kind,.subhabit)
        XCTAssertEqual(s.relationships.first { $0.childID == c }?.kind,.followUp)
    }
    func testReparentPreservesEffectiveHistoryAndRejectsCycleAtomically() throws {
        var (s,p) = try state(); let child = try s.createHabit(HabitConfiguration(name: "Child", from: day)); let other = try s.createHabit(HabitConfiguration(name: "Other", from: day))
        try s.changeOrdinaryParent(childID: child, parentID: p, from: day)
        try s.changeOrdinaryParent(childID: child, parentID: other, from: day.adding(days: 1))
        XCTAssertEqual(s.relationships.first { $0.childID == child && $0.effective.contains(day) }?.parentID,p)
        let before = s
        XCTAssertThrowsError(try s.changeOrdinaryParent(childID: other, parentID: child, from: day.adding(days: 1)))
        XCTAssertEqual(s,before)
    }
    func testDateCorrectionMovesContributionAndKeepsChain() throws {
        var (s,p) = try state(); try s.record(habitID: p, on: day, value: .boolean(true), occurrenceMinute: 600)
        let original = s.observations[0]
        let next = try day.adding(days: 1)
        try s.record(habitID: p, on: next, value: .boolean(true), supersedes: original.id, occurrenceMinute: 800)
        XCTAssertEqual(try s.status(habitID: p, on: day).outcome,.missing)
        XCTAssertEqual(try s.status(habitID: p, on: next).outcome,.success)
        XCTAssertEqual(s.observations[0],original)
        XCTAssertEqual(s.observations.last?.correctionReason,.correctDate)
        let restored = try PlannerSnapshot.decode(s.encoded())
        XCTAssertEqual(restored.leaves(habitID: p, on: next).first?.occurrenceMinute,800)
    }
    func testFutureAndUnavailableDateCorrectionRejected() throws {
        var (s,p) = try state(); try s.record(habitID: p, on: day, value: .boolean(true))
        let before = s
        XCTAssertThrowsError(try s.record(habitID: p, on: CalendarDay.today.adding(days: 1), value: .boolean(true), supersedes: s.observations[0].id))
        XCTAssertEqual(s,before)
    }
    func testUnlinkAndArchiveKeepCorrectableDetachedContext() throws {
        var (s,p) = try state(); let child = try s.createHabit(HabitConfiguration(name: "Child", from: day))
        try s.record(habitID: p, on: day, value: .boolean(true))
        let relation = Relationship(parentID: p, childID: child, kind: .followUp, from: day)
        try s.addRelationship(relation)
        try s.record(habitID: child, on: day, value: .boolean(true))
        let fact = s.observations.last!
        try s.unlinkRelationship(relation.id, from: day)
        try s.setArchived(child, archived: true, from: day)
        try s.record(habitID: child, on: day, value: .boolean(false), supersedes: fact.id)
        let leaf = try XCTUnwrap(try PlannerSnapshot.decode(s.encoded()).leaves(habitID: child, on: day).first)
        XCTAssertEqual(leaf.contextRelationship?.id,relation.id)
        XCTAssertEqual(leaf.value,.boolean(false))
    }
    func testChecklistClosureRecordsAndReopeningVoidsWithoutErasure() throws {
        var (s,p) = try state(); s.habits[0].configurations[0].closesByChecklist = true
        let item = ChecklistItem(habitID: p, text: "Prepare", from: day); s.checklist.append(item)
        try s.toggleChecklist(item.id, on: day)
        XCTAssertEqual(s.observations.last?.value,.boolean(true))
        let original = s.observations[0]
        try s.toggleChecklist(item.id, on: day)
        XCTAssertEqual(s.observations[0],original); XCTAssertEqual(s.observations.last?.value,.void)
        XCTAssertEqual(try s.status(habitID: p, on: day).outcome,.missing)
        XCTAssertThrowsError(try s.record(habitID: p, on: day, value: .boolean(true)))
    }
    func testChecklistRemovalCannotEraseTickHistory() throws {
        var (s,p) = try state(); var item = ChecklistItem(habitID: p, text: "Prepare", from: day)
        item.checkedDays.insert(day); s.checklist.append(item)
        XCTAssertThrowsError(try s.removeChecklistItem(item.id, from: day))
        try s.removeChecklistItem(item.id, from: day.adding(days: 1))
        XCTAssertTrue(s.checklist[0].checkedDays.contains(day))
    }
    func testFocusCopyExtendPinSearchAndDuplicateProtection() throws {
        var s = PlannerSnapshot(); var focus = DailyFocus(title: "Finish chapter", day: day)
        var item = TaskCheck(text: "References"); item.done = true; focus.checklist = [item]; focus.body = "Research notes"
        try s.saveFocus(focus)
        let copied = try s.copyFocus(focus.id, to: day.adding(days: 1))
        XCTAssertFalse(try XCTUnwrap(s.focusEntries.first { $0.id == copied }).checklist[0].done)
        let extended = try s.copyFocus(focus.id, to: day.adding(days: 2), extending: true)
        XCTAssertTrue(try XCTUnwrap(s.focusEntries.first { $0.id == extended }).checklist[0].done)
        try s.pinFocus(focus.id, from: day, through: day.adding(days: 4))
        XCTAssertTrue(s.focusEntries[0].isVisible(on: try day.adding(days: 4)))
        XCTAssertFalse(s.focusEntries[0].isVisible(on: try day.adding(days: 5)))
        XCTAssertEqual(s.searchFocus("references").count,3)
        let before = s
        XCTAssertThrowsError(try s.saveFocus(DailyFocus(title: "Duplicate", day: day))); XCTAssertEqual(s,before)
        _ = try PlannerSnapshot.decode(s.encoded())
    }
    func testFocusConversionIsIdempotentAndRetainsProvenance() throws {
        var s = PlannerSnapshot(); let focus = DailyFocus(title: "Draft", day: day); try s.saveFocus(focus)
        let id = try s.convertFocusToTask(focus.id, on: day)
        XCTAssertEqual(try s.convertFocusToTask(focus.id, on: day),id)
        XCTAssertEqual(s.tasks.count,1); XCTAssertTrue(s.focusEntries[0].archived)
        XCTAssertEqual(s.focusEntries[0].convertedTaskID,id)
        try s.validate()
    }
    func testOldNativeBackupWithoutNewFieldsStillDecodes() throws {
        var (s,p) = try state(); try s.record(habitID: p, on: day, value: .boolean(true))
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: s.encoded()) as? [String:Any])
        json.removeValue(forKey: "dailyFocus")
        var facts = try XCTUnwrap(json["observations"] as? [[String:Any]])
        for key in ["occurrenceMinute","correctionReason","contextConfiguration","contextRelationship"] { facts[0].removeValue(forKey: key) }
        json["observations"] = facts
        let restored = try PlannerSnapshot.decode(JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(try restored.status(habitID: p, on: day).outcome,.success); XCTAssertTrue(restored.focusEntries.isEmpty)
    }
    func testGrowingLimitStopAndDetails() throws {
        var (s,p) = try state(); let b = try s.createHabit(HabitConfiguration(name: "B", from: day)); let c = try s.createHabit(HabitConfiguration(name: "C", from: day)); let d = try s.createHabit(HabitConfiguration(name: "D", from: day))
        for id in [p,b,c] { try s.restartGrowth(habitID: id, on: day, cue: "After coffee", enjoyment: "yes") }
        XCTAssertThrowsError(try s.restartGrowth(habitID: d, on: day, cue: "", enjoyment: ""))
        let first = s.attempts[0].id
        try s.updateGrowth(first, cue: "After breakfast", enjoyment: "tolerated")
        XCTAssertEqual(s.attempts[0].cue,"After breakfast")
        try s.stopGrowth(first, from: day.adding(days: 1))
        try s.restartGrowth(habitID: d, on: day.adding(days: 1), cue: "", enjoyment: "no")
        XCTAssertEqual(s.attempts.filter { $0.endExclusive == nil }.count,3)
        _ = try PlannerSnapshot.decode(s.encoded())
    }
}
