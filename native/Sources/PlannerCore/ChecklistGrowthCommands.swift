import Foundation

extension PlannerSnapshot {
    public mutating func removeChecklistItem(_ id: UUID, from day: CalendarDay) throws {
        guard let i = checklist.firstIndex(where: { $0.id == id && $0.effective.contains(day) }) else { throw PlannerError.missing("Checklist item not found") }
        guard !checklist[i].checkedDays.contains(where: { $0 >= day }) else { throw PlannerError.conflict("This change would erase recorded checklist history. Choose a date after the last tick.") }
        if checklist[i].effective.start == day { checklist.remove(at: i) }
        else { checklist[i].effective.endExclusive = day }
    }
    public mutating func stopGrowth(_ attemptID: UUID, from day: CalendarDay) throws {
        guard let i = attempts.firstIndex(where: { $0.id == attemptID }) else { throw PlannerError.missing("Growth attempt not found") }
        guard attempts[i].endExclusive == nil, day > attempts[i].start else { throw PlannerError.conflict("Choose a stop date after the start of the open attempt") }
        attempts[i].endExclusive = day
    }
    public mutating func updateGrowth(_ attemptID: UUID, cue: String, enjoyment: String) throws {
        guard let i = attempts.firstIndex(where: { $0.id == attemptID }) else { throw PlannerError.missing("Growth attempt not found") }
        guard cue.trimmingCharacters(in: .whitespacesAndNewlines).count <= 120,
              ["","yes","tolerated","no"].contains(enjoyment) else { throw PlannerError.invalid("Invalid growth details") }
        attempts[i].cue = cue.trimmingCharacters(in: .whitespacesAndNewlines); attempts[i].enjoyment = enjoyment
    }
}
