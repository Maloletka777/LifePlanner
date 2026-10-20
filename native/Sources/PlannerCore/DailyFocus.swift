import Foundation

public enum FocusProvenance: String, Codable, Sendable { case original, copiedForward, extended }
public struct DailyFocus: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var day: CalendarDay
    public var title: String
    public var body = ""
    public var archived = false
    public var provenance: FocusProvenance = .original
    public var sourceID: UUID?
    public var pinned: DayRange?
    public var convertedTaskID: UUID?
    public var checklist: [TaskCheck] = []
    public var createdAt = Date()
    public init(title: String, day: CalendarDay) { self.title = title; self.day = day }
    public func isVisible(on day: CalendarDay) -> Bool { !archived && (self.day == day || (pinned?.contains(day) ?? false)) }
}
extension PlannerSnapshot {
    public mutating func saveFocus(_ focus: DailyFocus) throws {
        var candidate = self
        if let i = candidate.focusEntries.firstIndex(where: { $0.id == focus.id }) { candidate.focusEntries[i] = focus }
        else { candidate.focusEntries.append(focus) }
        try candidate.validateFocus(); self = candidate
    }
    public mutating func copyFocus(_ id: UUID, to day: CalendarDay, extending: Bool = false) throws -> UUID {
        guard let original = focusEntries.first(where: { $0.id == id }) else { throw PlannerError.missing("Focus not found") }
        guard day > original.day else { throw PlannerError.invalid("Copy or extend to a later day") }
        var copy = DailyFocus(title: original.title, day: day)
        copy.body = original.body; copy.sourceID = original.id
        copy.provenance = extending ? .extended : .copiedForward
        copy.checklist = original.checklist.map { item in
            var result = TaskCheck(text: item.text)
            // An extension continues the outstanding work; a copy starts fresh.
            result.done = extending && item.done
            return result
        }
        if extending { copy.pinned = DayRange(start: day, endExclusive: try day.adding(days: 1)) }
        try saveFocus(copy); return copy.id
    }
    public mutating func pinFocus(_ id: UUID, from start: CalendarDay, through endInclusive: CalendarDay) throws {
        guard let i = focusEntries.firstIndex(where: { $0.id == id }) else { throw PlannerError.missing("Focus not found") }
        var focus = focusEntries[i]
        focus.pinned = DayRange(start: start, endExclusive: try endInclusive.adding(days: 1))
        try saveFocus(focus)
    }
    public mutating func convertFocusToTask(_ id: UUID, on day: CalendarDay) throws -> UUID {
        guard let i = focusEntries.firstIndex(where: { $0.id == id }) else { throw PlannerError.missing("Focus not found") }
        if let taskID = focusEntries[i].convertedTaskID {
            guard tasks.contains(where: { $0.id == taskID }) else { throw PlannerError.conflict("The previously converted task was deleted") }
            return taskID
        }
        var candidate = self
        let focus = candidate.focusEntries[i]
        var task = PlannerTask(title: focus.title, day: day); task.note = focus.body
        task.checklist = focus.checklist.map { item in var copy = TaskCheck(text: item.text); copy.done = item.done; return copy }
        candidate.tasks.append(task)
        candidate.focusEntries[i].convertedTaskID = task.id
        candidate.focusEntries[i].archived = true
        try candidate.validate(); self = candidate; return task.id
    }
    public func searchFocus(_ query: String, includeArchived: Bool = true) -> [DailyFocus] {
        focusEntries.filter { focus in
            (includeArchived || !focus.archived) && (query.isEmpty ||
                ([focus.title,focus.body] + focus.checklist.map(\.text)).contains { $0.localizedCaseInsensitiveContains(query) })
        }.sorted { $0.day == $1.day ? $0.id.uuidString < $1.id.uuidString : $0.day > $1.day }
    }
    internal func validateFocus() throws {
        let entries = focusEntries
        guard Set(entries.map(\.id)).count == entries.count,
              Set(entries.filter({ !$0.archived }).map(\.day)).count == entries.filter({ !$0.archived }).count else {
            throw PlannerError.invalid("Only one active Daily Focus is allowed per date")
        }
        let byID = Dictionary(uniqueKeysWithValues: entries.map { ($0.id,$0) })
        for focus in entries {
            guard !focus.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  Set(focus.checklist.map(\.id)).count == focus.checklist.count,
                  focus.checklist.allSatisfy({ !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                throw PlannerError.invalid("Invalid focus title or checklist")
            }
            try focus.pinned?.validate()
            if focus.provenance == .original {
                guard focus.sourceID == nil else { throw PlannerError.invalid("Original focus cannot have a source") }
            } else {
                guard let source = focus.sourceID, let original = byID[source], original.day < focus.day else {
                    throw PlannerError.invalid("Focus provenance must reference an earlier entry")
                }
            }
        }
    }
}
