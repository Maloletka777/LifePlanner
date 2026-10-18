import Foundation

extension PlannerSnapshot {
    public func validate() throws {
        guard formatVersion == 1, revision >= 0 else { throw PlannerError.invalid("Unsupported backup format or revision") }
        func unique<T: Hashable>(_ ids: [T]) throws {
            guard Set(ids).count == ids.count else { throw PlannerError.invalid("Duplicate identifiers in backup") }
        }
        try unique(habits.map(\.id)); try unique(observations.map(\.id)); try unique(tasks.map(\.id))
        try unique(checklist.map(\.id)); try unique(reminders.map(\.id)); try unique(attempts.map(\.id))
        try unique(relationships.map(\.id)); try unique(journal.map(\.day))
        let habitIDs = Set(habits.map(\.id))
        for habit in habits {
            guard !habit.configurations.isEmpty else { throw PlannerError.invalid("Habit has no configuration") }
            try unique(habit.configurations.map(\.id))
            for (i, config) in habit.configurations.enumerated() {
                try config.validate()
                if i > 0 {
                    let previous = habit.configurations[i - 1]
                    guard previous.effective.endExclusive == config.effective.start else { throw PlannerError.invalid("Configuration history must be contiguous") }
                }
            }
            guard habit.configurations.last?.effective.endExclusive == nil else { throw PlannerError.invalid("Last configuration must remain open") }
            for pair in zip(habit.lifecycle, habit.lifecycle.dropFirst()) where pair.0.day > pair.1.day {
                throw PlannerError.invalid("Lifecycle history is out of order")
            }
        }
        var seen: [UUID: Observation] = [:]; var corrected: Set<UUID> = []
        for fact in observations {
            guard let habit = habits.first(where: { $0.id == fact.habitID }),
                  let configuration = habit.configurations.first(where: { $0.id == fact.configurationID }),
                  configuration.effective.contains(fact.day), TimeZone(identifier: fact.timezone) != nil else {
                throw PlannerError.invalid("Observation refers to missing or inapplicable configuration")
            }
            switch fact.value {
            case .amount(let n):
                guard !n.isNaN, n >= 0, n <= Decimal(1_000_000_000_000), configuration.tracking.mode != .checkbox,
                      configuration.tracking.mode != .avoidance else { throw PlannerError.invalid("Observation type or amount is invalid") }
                if configuration.tracking.mode == .counter || configuration.tracking.mode == .duration {
                    var input = n; var rounded = Decimal(); NSDecimalRound(&rounded, &input, 0, .plain)
                    guard n == rounded else { throw PlannerError.invalid("Non-integral count or duration") }
                }
            case .boolean:
                guard configuration.tracking.mode == .checkbox || configuration.tracking.mode == .avoidance else { throw PlannerError.invalid("Observation type mismatch") }
            case .void:
                guard fact.supersedes != nil else { throw PlannerError.invalid("Void without original observation") }
            case .skipped: break
            }
            if let parent = fact.supersedes {
                guard let previous = seen[parent], previous.habitID == fact.habitID, previous.day == fact.day,
                      previous.recordedAt <= fact.recordedAt, corrected.insert(parent).inserted else {
                    throw PlannerError.invalid("Broken or branching correction history")
                }
            }
            seen[fact.id] = fact
        }
        for link in relationships {
            try link.effective.validate()
            guard habitIDs.contains(link.parentID), habitIDs.contains(link.childID), link.parentID != link.childID else {
                throw PlannerError.invalid("Invalid habit relationship")
            }
        }
        // Validate cycles at each effective-date boundary, allowing non-overlapping historical relationships.
        for boundary in Set(relationships.flatMap { [$0.effective.start] + ($0.effective.endExclusive.map { [$0] } ?? []) }) {
            let active = relationships.filter { $0.effective.contains(boundary) }
            for child in Set(active.map(\.childID)) {
                guard active.filter({ $0.childID == child }).count <= 1 else { throw PlannerError.invalid("A habit can have one active parent") }
            }
            func visit(_ id: UUID, path: Set<UUID>) throws {
                guard !path.contains(id) else { throw PlannerError.invalid("Habit relationship cycle") }
                var path = path; path.insert(id)
                for link in active where link.parentID == id { try visit(link.childID, path: path) }
            }
            for id in habitIDs { try visit(id, path: []) }
        }
        for item in checklist {
            try item.effective.validate()
            guard habitIDs.contains(item.habitID), !item.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  item.checkedDays.allSatisfy({ item.effective.contains($0) }) else { throw PlannerError.invalid("Invalid checklist item") }
        }
        for task in tasks {
            guard !task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PlannerError.invalid("Task needs a title") }
            if let minute = task.plannedMinute, !(0..<1440).contains(minute) { throw PlannerError.invalid("Invalid task time") }
            if let duration = task.durationMinutes, duration <= 0 { throw PlannerError.invalid("Invalid task duration") }
            try unique(task.checklist.map(\.id))
            guard task.checklist.allSatisfy({ !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { throw PlannerError.invalid("Empty task checklist item") }
        }
        for reminder in reminders {
            guard habitIDs.contains(reminder.habitID), (0..<1440).contains(reminder.minute) else { throw PlannerError.invalid("Invalid reminder") }
        }
        for attempt in attempts {
            guard habitIDs.contains(attempt.habitID) else { throw PlannerError.invalid("Growth attempt refers to missing habit") }
            try DayRange(start: attempt.start, endExclusive: attempt.endExclusive).validate()
        }
        for habitID in habitIDs {
            let history = attempts.filter { $0.habitID == habitID }.sorted { $0.start < $1.start }
            for pair in zip(history, history.dropFirst()) {
                guard let end = pair.0.endExclusive, end <= pair.1.start else { throw PlannerError.invalid("Overlapping growth attempts") }
            }
        }
    }
}
