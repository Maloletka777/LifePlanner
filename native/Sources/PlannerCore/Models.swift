import Foundation

public enum TrackingMode: String, Codable, CaseIterable, Sendable { case checkbox, counter, quantity, duration, avoidance }
public enum Comparison: String, Codable, CaseIterable, Sendable { case atLeast, atMost, equal }
public enum Importance: String, Codable, CaseIterable, Sendable {
    case low, normal, high, critical
    public var weight: Int { switch self { case .low: 1; case .normal: 2; case .high: 3; case .critical: 4 } }
}
public enum DayBlock: String, Codable, CaseIterable, Sendable { case anytime, morning, afternoon, evening }
public struct Tracking: Codable, Equatable, Sendable {
    public var mode: TrackingMode = .checkbox
    public var comparison: Comparison = .atLeast
    public var target: Decimal = 1
    public var unit: String = ""
    public init() {}
    public func validate() throws {
        guard !target.isNaN, target > 0, target <= Decimal(1_000_000_000_000) else { throw PlannerError.invalid("Target must be positive and within supported precision") }
        if mode == .counter || mode == .duration {
            var original = target; var rounded = Decimal()
            NSDecimalRound(&rounded, &original, 0, .plain)
            guard rounded == target else { throw PlannerError.invalid("Counts and duration seconds must be whole numbers") }
        }
        if mode == .quantity && unit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw PlannerError.invalid("Quantity requires a unit")
        }
    }
    public func qualifies(_ value: Decimal) -> Bool {
        switch comparison { case .atLeast: value >= target; case .atMost: value <= target; case .equal: value == target }
    }
}
public struct HabitConfiguration: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID = UUID()
    public var effective: DayRange
    public var name: String
    public var detail: String = ""
    public var category: String = "Personal"
    public var symbol: String = "leaf.fill"
    public var accent: String = "sage"
    public var schedule = Schedule()
    public var tracking = Tracking()
    public var importance: Importance = .normal
    public var plannedMinute: Int?
    public var durationMinutes: Int?
    public var block: DayBlock = .anytime
    public var closesByChecklist = false
    public init(name: String, from: CalendarDay) { self.name = name; effective = DayRange(start: from) }
    public func validate() throws {
        try effective.validate(); try schedule.validate(); try tracking.validate()
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 200 else {
            throw PlannerError.invalid("Enter a title of up to 200 characters")
        }
        if let plannedMinute, !(0..<1440).contains(plannedMinute) { throw PlannerError.invalid("Invalid planned time") }
        if let durationMinutes, durationMinutes <= 0 { throw PlannerError.invalid("Duration must be positive") }
        if closesByChecklist && tracking.mode != .checkbox { throw PlannerError.invalid("Checklist closure requires checkbox tracking") }
    }
}
public struct LifecycleChange: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var day: CalendarDay
    public var archived: Bool
    public var recordedAt: Date = Date()
    public init(day: CalendarDay, archived: Bool) { self.day = day; self.archived = archived }
}
public struct Habit: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID = UUID()
    public var configurations: [HabitConfiguration]
    public var lifecycle: [LifecycleChange] = []
    public var createdAt: Date = Date()
    public init(configuration: HabitConfiguration) { configurations = [configuration] }
    public func configuration(on day: CalendarDay) -> HabitConfiguration? {
        configurations.last { $0.effective.contains(day) }
    }
    public func isArchived(on day: CalendarDay) -> Bool {
        lifecycle.enumerated().filter { $0.element.day <= day }
            .max { a,b in a.element.day == b.element.day ? a.offset < b.offset : a.element.day < b.element.day }?.element.archived ?? false
    }
}
public enum ObservationValue: Codable, Equatable, Sendable {
    case boolean(Bool), amount(Decimal), skipped, void
}
public enum CorrectionReason: String, Codable, CaseIterable, Sendable { case correctValue, correctDate, duplicateEntry, reversal, other }
public struct Observation: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var habitID: UUID
    public var configurationID: UUID
    public var day: CalendarDay
    public var value: ObservationValue
    public var timezone: String
    public var supersedes: UUID?
    public var note: String
    public var occurrenceMinute: Int?
    public var correctionReason: CorrectionReason?
    /// Immutable context allows history to remain interpretable after a relationship
    /// ends or a configuration is subsequently edited.
    public var contextConfiguration: HabitConfiguration?
    public var contextRelationship: Relationship?
    public var recordedAt: Date = Date()
    public init(habitID: UUID, configurationID: UUID, day: CalendarDay, value: ObservationValue,
                timezone: String, supersedes: UUID? = nil, note: String = "", occurrenceMinute: Int? = nil,
                correctionReason: CorrectionReason? = nil, contextConfiguration: HabitConfiguration? = nil,
                contextRelationship: Relationship? = nil) {
        self.habitID = habitID; self.configurationID = configurationID; self.day = day; self.value = value
        self.timezone = timezone; self.supersedes = supersedes; self.note = note
        self.occurrenceMinute = occurrenceMinute; self.correctionReason = correctionReason
        self.contextConfiguration = contextConfiguration; self.contextRelationship = contextRelationship
    }
}
public enum RelationshipKind: String, Codable, CaseIterable, Sendable { case subhabit, prerequisite, followUp, routineStep }
public struct Relationship: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var parentID: UUID
    public var childID: UUID
    public var kind: RelationshipKind
    public var effective: DayRange
    public var order: Int = 0
    public init(parentID: UUID, childID: UUID, kind: RelationshipKind, from: CalendarDay, order: Int = 0) {
        self.parentID = parentID; self.childID = childID; self.kind = kind
        effective = DayRange(start: from); self.order = order
    }
}
public struct ChecklistItem: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var habitID: UUID
    public var text: String
    public var effective: DayRange
    public var checkedDays: Set<CalendarDay> = []
    public init(habitID: UUID, text: String, from: CalendarDay) {
        self.habitID = habitID; self.text = text; effective = DayRange(start: from)
    }
}
public struct PlannerTask: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var day: CalendarDay
    public var title: String
    public var note = ""
    public var done = false
    public var archived = false
    public var plannedMinute: Int?
    public var durationMinutes: Int?
    public var block: DayBlock = .anytime
    public var checklist: [TaskCheck] = []
    public init(title: String, day: CalendarDay) { self.title = title; self.day = day }
}
public struct TaskCheck: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var text: String
    public var done = false
    public init(text: String) { self.text = text }
}
public struct JournalEntry: Codable, Equatable, Sendable {
    public var day: CalendarDay
    public var focus = ""
    public var note = ""
    public init(day: CalendarDay) { self.day = day }
}
public struct GrowthAttempt: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var habitID: UUID
    public var start: CalendarDay
    public var endExclusive: CalendarDay?
    public var cue = ""
    public var enjoyment = ""
    public init(habitID: UUID, start: CalendarDay) { self.habitID = habitID; self.start = start }
}
public struct Reminder: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var habitID: UUID
    public var minute: Int
    public var enabled = true
    public init(habitID: UUID, minute: Int) { self.habitID = habitID; self.minute = minute }
}
public struct PlannerSnapshot: Codable, Equatable, Sendable {
    public var formatVersion = 1
    public var revision: Int64 = 0
    public var habits: [Habit] = []
    public var observations: [Observation] = []
    public var relationships: [Relationship] = []
    public var checklist: [ChecklistItem] = []
    public var tasks: [PlannerTask] = []
    public var journal: [JournalEntry] = []
    public var dailyFocus: [DailyFocus]?
    public var focusEntries: [DailyFocus] {
        get { dailyFocus ?? [] }
        set { dailyFocus = newValue }
    }
    public var attempts: [GrowthAttempt] = []
    public var reminders: [Reminder] = []
    public var weightedProgress = false
    public init() {}
    public func encoded() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(self)
    }
    public static func decode(_ data: Data) throws -> Self {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        let result = try decoder.decode(Self.self, from: data)
        try result.validate(); return result
    }
}
