import XCTest
@testable import PlannerCore

final class DiagnosisTests: XCTestCase {
    let monday = try! CalendarDay("2026-08-03")
    func row(_ offset: Int, closed: Bool, planned: DayBlock? = .evening, actual: DayBlock? = .evening, count: Int = 1, position: Int = 1) throws -> DiagnosisOccurrence {
        DiagnosisOccurrence(day: try monday.adding(days: offset), closed: closed, plannedBlock: planned, actualBlock: actual, blockItemCount: count, positionInBlock: position)
    }
    func testWeekdayPatternMatchesLegacyThreeWeekFixture() throws {
        var rows: [DiagnosisOccurrence] = []
        for week in 0..<3 { rows += [try row(week*7, closed:true),try row(week*7+2, closed:false),try row(week*7+4, closed:true)] }
        let best = DiagnosisRules.diagnose(rows, spanDays:21).first
        XCTAssertEqual(best?.kind,.weekday); XCTAssertEqual(best?.weekday,3); XCTAssertEqual(best?.repeats,3)
    }
    func testWrongBlockNeedsExplicitActualTimeAndRepeatedEvidence() throws {
        let rows = try (0..<3).map { try row($0, closed:true, planned:.morning, actual:.afternoon) }
        XCTAssertEqual(DiagnosisRules.diagnose(rows, spanDays:3).first?.kind,.wrongBlock)
        let unknown = try (0..<3).map { try row($0, closed:true, planned:.morning, actual:nil) }
        XCTAssertTrue(DiagnosisRules.diagnose(unknown, spanDays:3).isEmpty)
        XCTAssertEqual(DiagnosisRules.actualBlock(minute:3*60),.evening)
        XCTAssertEqual(DiagnosisRules.actualBlock(minute:4*60),.morning)
        XCTAssertEqual(DiagnosisRules.actualBlock(minute:17*60),.evening)
    }
    func testFrequencyCrowdingAndLatePositionModels() throws {
        let rows = try (0..<8).map { try row($0, closed:$0<3, count:$0<3 ? 1:4, position:$0<3 ? 1:4) }
        let found = DiagnosisRules.diagnose(rows, spanDays:14)
        XCTAssertTrue(found.contains { $0.kind == .tooFrequent && $0.suggestedPerWeek == 2 })
        XCTAssertTrue(found.contains { $0.kind == .crowdedBlock && $0.crowdedAt == 2 })
        XCTAssertTrue(found.contains { $0.kind == .lateInChain && $0.position == 4 })
    }
    func testSparseAndSuccessfulHistoriesStayQuiet() throws {
        XCTAssertTrue(DiagnosisRules.diagnose(try [row(0,closed:false),row(1,closed:false)],spanDays:2).isEmpty)
        XCTAssertTrue(DiagnosisRules.diagnose(try (0..<14).map { try row($0,closed:true) },spanDays:14).isEmpty)
    }
}
