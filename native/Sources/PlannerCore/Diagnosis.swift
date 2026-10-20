import Foundation

public struct DiagnosisOccurrence: Sendable {
    public var day: CalendarDay
    public var closed: Bool
    public var plannedBlock: DayBlock?
    public var actualBlock: DayBlock?
    public var blockItemCount: Int
    public var positionInBlock: Int
    public init(day: CalendarDay, closed: Bool, plannedBlock: DayBlock? = nil, actualBlock: DayBlock? = nil, blockItemCount: Int = 1, positionInBlock: Int = 1) {
        self.day = day; self.closed = closed; self.plannedBlock = plannedBlock; self.actualBlock = actualBlock
        self.blockItemCount = blockItemCount; self.positionInBlock = positionInBlock
    }
}
public enum DiagnosisKind: String, Sendable { case weekday, wrongBlock, tooFrequent, crowdedBlock, lateInChain }
public struct RoutineDiagnosis: Identifiable, Equatable, Sendable {
    public var kind: DiagnosisKind
    public var repeats: Int
    public var weekday: Int?
    public var plannedBlock: DayBlock?
    public var actualBlock: DayBlock?
    public var suggestedPerWeek: Int?
    public var crowdedAt: Int?
    public var position: Int?
    public var id: String { kind.rawValue }
    public var message: String {
        switch kind {
        case .weekday: "One weekday has fewer recorded completions than the others. Consider reviewing that day's plan."
        case .wrongBlock: "Recorded completion times often fall in \(actualBlock?.rawValue ?? "another part of the day"). Consider moving the planned block."
        case .tooFrequent: "Recorded completion frequency is lower than the schedule. Consider \(suggestedPerWeek ?? 1) times per week."
        case .crowdedBlock: "Days with more items in this block have fewer recorded completions. Consider reducing the block's load."
        case .lateInChain: "This item is often not recorded as complete when placed late in its block. Consider moving it earlier."
        }
    }
}
public enum DiagnosisRules {
    /// Thresholds and tie order ported from routine-diagnosis-model.ts. These are
    /// chosen product heuristics, not learned coefficients or causal conclusions.
    public static func diagnose(_ rows: [DiagnosisOccurrence], spanDays: Int) -> [RoutineDiagnosis] {
        var found: [RoutineDiagnosis] = []
        var worst: RoutineDiagnosis?
        var seenWeekdays: [Int] = []
        for row in rows where !seenWeekdays.contains(row.day.isoWeekday) { seenWeekdays.append(row.day.isoWeekday) }
        for weekday in seenWeekdays {
            let bucket = rows.filter { $0.day.isoWeekday == weekday }
            let misses = bucket.filter { !$0.closed }.count
            let others = rows.filter { $0.day.isoWeekday != weekday }
            if misses >= 3, Double(misses) / Double(bucket.count) >= 0.6, !others.isEmpty,
               Double(others.filter { !$0.closed }.count) / Double(others.count) <= 0.3,
               misses > (worst?.repeats ?? 0) {
                worst = RoutineDiagnosis(kind: .weekday, repeats: misses, weekday: weekday)
            }
        }
        if let worst { found.append(worst) }
        let moved = rows.filter { $0.closed && $0.plannedBlock != nil && $0.actualBlock != nil && $0.plannedBlock != $0.actualBlock }
        var actualOrder: [DayBlock] = []
        for row in moved { if let block = row.actualBlock, !actualOrder.contains(block) { actualOrder.append(block) } }
        var bestBlock: DayBlock?; var most = 0
        for block in actualOrder { let count = moved.filter { $0.actualBlock == block }.count; if count > most { most = count; bestBlock = block } }
        if most >= 3, let bestBlock { found.append(RoutineDiagnosis(kind: .wrongBlock, repeats: most, plannedBlock: moved.last?.plannedBlock, actualBlock: bestBlock)) }
        let missed = rows.filter { !$0.closed }; let closed = rows.filter(\.closed)
        if rows.count >= 6, missed.count >= 3, Double(closed.count) / Double(rows.count) <= 0.6 {
            let frequency = max(1, Int((Double(closed.count) / max(1, Double(spanDays) / 7)).rounded(.toNearestOrAwayFromZero)))
            found.append(RoutineDiagnosis(kind: .tooFrequent, repeats: missed.count, suggestedPerWeek: frequency))
        }
        if missed.count >= 3, !closed.isEmpty, let block = missed.first?.plannedBlock {
            let missedLoad = Double(missed.reduce(0) { $0 + $1.blockItemCount }) / Double(missed.count)
            let closedLoad = Double(closed.reduce(0) { $0 + $1.blockItemCount }) / Double(closed.count)
            if missedLoad - closedLoad >= 2 { found.append(RoutineDiagnosis(kind: .crowdedBlock, repeats: missed.count, plannedBlock: block, crowdedAt: Int(ceil(closedLoad)) + 1)) }
        }
        let late = missed.filter { $0.blockItemCount > 1 && Double($0.positionInBlock) / Double($0.blockItemCount) >= 0.66 }
        if late.count >= 3, let first = late.first, let block = first.plannedBlock {
            found.append(RoutineDiagnosis(kind: .lateInChain, repeats: late.count, plannedBlock: block, position: first.positionInBlock))
        }
        return found.enumerated().sorted { $0.element.repeats == $1.element.repeats ? $0.offset < $1.offset : $0.element.repeats > $1.element.repeats }.map(\.element)
    }
    public static func actualBlock(minute: Int) -> DayBlock {
        let hour = ((minute % 1440) + 1440) % 1440 / 60
        return hour >= 4 && hour < 12 ? .morning : hour >= 12 && hour < 17 ? .afternoon : .evening
    }
}
extension PlannerSnapshot {
    public func diagnoses(habitID: UUID, through boundary: CalendarDay = .today, historyDays: Int = 28) throws -> [RoutineDiagnosis] {
        guard (1...366).contains(historyDays) else { throw PlannerError.invalid("Invalid diagnosis window") }
        var rows: [DiagnosisOccurrence] = []
        for offset in (-historyDays)..<0 {
            let day = try boundary.adding(days: offset)
            guard let config = habits.first(where: { $0.id == habitID })?.configuration(on: day),
                  case .day = try config.schedule.occurrence(on: day) else { continue }
            let outcome = try status(habitID: habitID, on: day, boundary: boundary)
            guard outcome.included else { continue }
            let peers = habits.compactMap { habit -> (UUID,HabitConfiguration)? in
                guard let configuration = habit.configuration(on: day), configuration.block == config.block,
                      !habit.isArchived(on: day), (try? configuration.schedule.occurrence(on: day)) != nil else { return nil }
                return (habit.id,configuration)
            }.sorted { left,right in
                let a = left.1.plannedMinute ?? 1440, b = right.1.plannedMinute ?? 1440
                return a == b ? left.0.uuidString < right.0.uuidString : a < b
            }
            let taskCount = tasks.filter { !$0.archived && $0.day == day && $0.block == config.block }.count
            let latestTime = leaves(habitID: habitID, on: day).last(where: { $0.value != .skipped })?.occurrenceMinute
            rows.append(DiagnosisOccurrence(day: day, closed: outcome.outcome == .success,
                plannedBlock: config.block == .anytime ? nil : config.block,
                actualBlock: outcome.outcome == .success ? latestTime.map { DiagnosisRules.actualBlock(minute: $0) } : nil,
                blockItemCount: peers.count + taskCount,
                positionInBlock: (peers.firstIndex(where: { $0.0 == habitID }) ?? 0) + 1))
        }
        return DiagnosisRules.diagnose(rows, spanDays: historyDays)
    }
}
