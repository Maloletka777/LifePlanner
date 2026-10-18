import Foundation

/// Port of the existing rule-based routine-growth model. Thresholds are inherited
/// product rules, not fitted parameters or evidence of habit automaticity.
public enum GrowthState: String, Sendable { case growing, attention, interrupted, recovering, strengthened }
public struct GrowthOccurrence: Sendable {
    public var day: CalendarDay
    public var closed: Bool
    public init(day: CalendarDay, closed: Bool) { self.day = day; self.closed = closed }
}
public struct GrowthStatus: Sendable, Equatable {
    public var state: GrowthState
    public var currentRun: Int
    public var bestRun: Int
    public var consecutiveMisses: Int
    public var totalClosed: Int
    public var totalScheduled: Int
    public var breaks: Int
    public var returns: Int
    public var silentDays: Int
    public var medals: [Int]
    public var displayedRun: Int { state == .interrupted ? 0 : currentRun }
}
public struct GrowthAward: Equatable, Sendable {
    public var axis: String
    public var milestone: Int
}
public enum GrowthRules {
    public static let continuity = [7,14,30,66]
    public static func evaluate(_ occurrences: [GrowthOccurrence], from start: CalendarDay, through end: CalendarDay) -> GrowthStatus {
        let rows = occurrences.filter { $0.day >= start && $0.day <= end }.sorted { $0.day < $1.day }
        var current = 0, best = 0, misses = 0, closed = 0, breaks = 0, returns = 0, beforeBreak = 0
        var broken = false, everBroken = false
        var lastClosed: CalendarDay?
        func recordBreak() { broken = true; everBroken = true; breaks += 1; beforeBreak = current; current = 0 }
        for row in rows {
            if row.closed {
                if broken { broken = false; returns += 1 }
                misses = 0; current += 1; best = max(best,current); closed += 1; lastClosed = row.day
            } else {
                misses += 1
                if misses >= 3 && !broken { recordBreak() }
            }
        }
        let silence = max(0,(lastClosed ?? start).distance(to: end))
        if silence >= 14 && !broken { recordBreak() }
        let state: GrowthState = broken ? .interrupted : misses >= 2 ? .attention : everBroken && current > beforeBreak ? .strengthened : everBroken ? .recovering : .growing
        return GrowthStatus(state: state, currentRun: current, bestRun: best, consecutiveMisses: misses,
                            totalClosed: closed, totalScheduled: rows.count, breaks: breaks, returns: returns, silentDays: silence,
                            medals: continuity.filter { best >= $0 })
    }
    public static func awards(status: GrowthStatus, from start: CalendarDay, through end: CalendarDay, acceptedSuggestionsThatHeld: Int = 0) -> [GrowthAward] {
        var result = status.medals.map { GrowthAward(axis: "continuity", milestone: $0) }
        if status.returns > 0 { result += (1...min(3,status.returns)).map { GrowthAward(axis: "survival", milestone: $0) } }
        result += [1,3].filter { acceptedSuggestionsThatHeld >= $0 }.map { GrowthAward(axis: "optimisation", milestone: $0) }
        result += [30,182,365].filter { start.distance(to: end) >= $0 }.map { GrowthAward(axis: "age", milestone: $0) }
        result += [50,100,365].filter { status.totalClosed >= $0 }.map { GrowthAward(axis: "total", milestone: $0) }
        return result
    }
}
extension PlannerSnapshot {
    public func growthStatus(attempt: GrowthAttempt, through boundary: CalendarDay = .today) throws -> GrowthStatus {
        // Today's still-open occurrence is not a miss. Flexible schedules count once,
        // after their period closes, instead of counting the same week seven times.
        let until = min(boundary, attempt.endExclusive ?? boundary)
        var cursor = attempt.start
        var rows: [GrowthOccurrence] = []
        while cursor < until {
            let outcome = try status(habitID: attempt.habitID, on: cursor, boundary: boundary)
            if let habit = habits.first(where: { $0.id == attempt.habitID }), let configuration = habit.configuration(on: cursor),
               let occurrence = try configuration.schedule.occurrence(on: cursor) {
                switch occurrence {
                case .day:
                    if outcome.included { rows.append(GrowthOccurrence(day: cursor, closed: outcome.outcome == .success)) }
                    cursor = try cursor.adding(days: 1)
                case .period(_,let end,_):
                    if end <= until {
                        let lastDay = try end.adding(days: -1)
                        let final = try status(habitID: attempt.habitID, on: lastDay, boundary: boundary)
                        if final.included { rows.append(GrowthOccurrence(day: lastDay, closed: final.outcome == .success)) }
                    }
                    cursor = end
                }
            } else { cursor = try cursor.adding(days: 1) }
        }
        return GrowthRules.evaluate(rows, from: attempt.start, through: until)
    }
}
