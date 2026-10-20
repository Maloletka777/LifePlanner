import XCTest
@testable import PlannerCore

final class GrowthTests: XCTestCase {
    let start = try! CalendarDay("2026-01-01")
    func occurrences(_ values: [Bool]) throws -> [GrowthOccurrence] {
        try values.enumerated().map { GrowthOccurrence(day: try start.adding(days: $0.offset), closed: $0.element) }
    }
    func testTwoMissesFreezeAndReturnContinues() throws {
        let rows = try occurrences([true,true,false,false])
        let state = GrowthRules.evaluate(rows, from: start, through: try start.adding(days: 3))
        XCTAssertEqual(state.state, .attention); XCTAssertEqual(state.displayedRun, 2)
        let resumed = GrowthRules.evaluate(try occurrences([true,true,false,false,true]), from: start, through: try start.adding(days: 4))
        XCTAssertEqual(resumed.currentRun, 3); XCTAssertEqual(resumed.breaks, 0)
    }
    func testThirdMissBreaksAndReturnCanStrengthen() throws {
        let interrupted = GrowthRules.evaluate(try occurrences([true,false,false,false]), from: start, through: try start.adding(days: 3))
        XCTAssertEqual(interrupted.state, .interrupted); XCTAssertEqual(interrupted.displayedRun, 0)
        let resumed = GrowthRules.evaluate(try occurrences([true,false,false,false,true,true]), from: start, through: try start.adding(days: 5))
        XCTAssertEqual(resumed.state, .strengthened); XCTAssertEqual(resumed.returns, 1)
    }
    func testEarnedAwardsSurviveBreak() throws {
        let values = Array(repeating: true, count: 7) + [false,false,false]
        let status = GrowthRules.evaluate(try occurrences(values), from: start, through: try start.adding(days: 9))
        XCTAssertEqual(status.medals, [7]); XCTAssertEqual(status.state, .interrupted)
        XCTAssertTrue(GrowthRules.awards(status: status, from: start, through: try start.adding(days: 9)).contains(GrowthAward(axis: "continuity", milestone: 7)))
    }
    func testSilenceInterruptsWithoutScheduledMisses() throws {
        let status = GrowthRules.evaluate([], from: start, through: try start.adding(days: 14))
        XCTAssertEqual(status.state, .interrupted); XCTAssertEqual(status.breaks, 1)
    }
}
