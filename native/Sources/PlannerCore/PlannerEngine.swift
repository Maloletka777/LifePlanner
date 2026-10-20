import Foundation

public enum Outcome: String, Codable, Sendable { case success, unsuccessful, missing, skipped, blocked, notScheduled, future, provisional }
public struct HabitStatus: Sendable, Equatable {
    public var outcome: Outcome
    public var actual: Decimal?
    public var credit: Decimal
    public var included: Bool
    public var periodSuccesses: Int = 0
    public var periodTarget: Int?
    public var isRoutineContainer = false
    public var applicableSteps = 0
    public var completedSteps = 0
    public init(_ outcome: Outcome, actual: Decimal? = nil, credit: Decimal = 0, included: Bool = false) {
        self.outcome = outcome; self.actual = actual; self.credit = credit; self.included = included
    }
}

extension PlannerSnapshot {
    public func leaves(habitID: UUID, on day: CalendarDay, asOf: Date = .distantFuture) -> [Observation] {
        let available = observations.filter { $0.habitID == habitID && $0.recordedAt <= asOf }
        let superseded = Set(available.compactMap(\.supersedes))
        // Array order is the committed observation order and survives export/restore.
        return available.filter { $0.day == day && !superseded.contains($0.id) && $0.value != .void }
    }
    public func status(habitID: UUID, on day: CalendarDay, boundary: CalendarDay = .today, asOf: Date = .distantFuture) throws -> HabitStatus {
        try status(habitID: habitID, on: day, boundary: boundary, asOf: asOf, visited: [])
    }
    private func status(habitID: UUID, on day: CalendarDay, boundary: CalendarDay, asOf: Date, visited: Set<UUID>) throws -> HabitStatus {
        guard !visited.contains(habitID) else { throw PlannerError.invalid("Relationship cycle") }
        var visited = visited; visited.insert(habitID)
        guard let habit = habits.first(where: { $0.id == habitID }), let config = habit.configuration(on: day), !habit.isArchived(on: day) else { return HabitStatus(.notScheduled) }
        let parentLinks = relationships.filter { $0.childID == habitID && $0.effective.contains(day) }
        // Only conditional dependencies inherit an occurrence. Ordinary routine steps
        // are independently scheduled roots, as in the legacy occurrence read model.
        var occurrence = try config.schedule.occurrence(on: day)
        if let inherited = parentLinks.first(where: { $0.kind == .followUp || $0.kind == .prerequisite }) {
            guard let parent = habits.first(where: { $0.id == inherited.parentID }),
                  let parentConfig = parent.configuration(on: day), !parent.isArchived(on: day) else { return HabitStatus(.notScheduled) }
            occurrence = try parentConfig.schedule.occurrence(on: day)
        }
        guard let occurrence else { return HabitStatus(.notScheduled) }
        if day > boundary { return HabitStatus(.future) }
        for link in parentLinks where link.kind == .followUp {
            let parentStatus = try status(habitID: link.parentID, on: day, boundary: boundary, asOf: asOf, visited: visited)
            if parentStatus.outcome != .success { return HabitStatus(.blocked) }
        }
        for link in relationships where link.parentID == habitID && link.kind == .prerequisite && link.effective.contains(day) {
            let prerequisite = try status(habitID: link.childID, on: day, boundary: boundary, asOf: asOf, visited: visited)
            if prerequisite.outcome != .success { return HabitStatus(.blocked) }
        }
        let steps = relationships.filter { $0.parentID == habitID && $0.kind == .routineStep && $0.effective.contains(day) }
        if !steps.isEmpty {
            var result = HabitStatus(.missing)
            result.isRoutineContainer = true
            var credit = Decimal.zero
            for step in steps {
                let status = try status(habitID: step.childID, on: day, boundary: boundary, asOf: asOf, visited: visited)
                guard status.outcome != .notScheduled, status.outcome != .skipped, status.outcome != .future else { continue }
                result.applicableSteps += 1
                credit += status.credit
                if status.outcome == .success { result.completedSteps += 1 }
            }
            if result.applicableSteps > 0 {
                result.included = true
                result.credit = credit / Decimal(result.applicableSteps)
                if result.completedSteps == result.applicableSteps { result.outcome = .success }
            }
            return result
        }
        var result = dailyStatus(habitID: habitID, config: config, day: day, asOf: asOf, isOpen: day == boundary)
        if case .period(let start, let end, let target) = occurrence {
            var successes = 0
            var cursor = max(start, config.effective.start)
            let until = min(end, try boundary.adding(days: 1))
            while cursor < until {
                if habit.configuration(on: cursor)?.id == config.id && !habit.isArchived(on: cursor),
                   dailyStatus(habitID: habitID, config: config, day: cursor, asOf: asOf, isOpen: cursor == boundary).outcome == .success { successes += 1 }
                cursor = try cursor.adding(days: 1)
            }
            result.periodSuccesses = successes; result.periodTarget = target
            result.credit = min(1, Decimal(successes) / Decimal(target))
            result.included = result.outcome != .skipped
            if successes >= target { result.outcome = .success }
        }
        return result
    }
    private func dailyStatus(habitID: UUID, config: HabitConfiguration, day: CalendarDay, asOf: Date, isOpen: Bool = false) -> HabitStatus {
        let facts = leaves(habitID: habitID, on: day, asOf: asOf)
        if facts.last?.value == .skipped { return HabitStatus(.skipped) }
        let checklistItems = checklist.filter { $0.habitID == habitID && $0.effective.contains(day) }
        if config.closesByChecklist && !checklistItems.isEmpty {
            let checked = checklistItems.filter { $0.checkedDays.contains(day) }.count
            return HabitStatus(checked == checklistItems.count ? .success : .missing,
                               credit: Decimal(checked) / Decimal(checklistItems.count), included: true)
        }
        let measured = facts.filter { $0.value != .skipped }
        guard !measured.isEmpty else { return HabitStatus(.missing, included: true) }
        if config.tracking.mode == .checkbox || config.tracking.mode == .avoidance {
            guard case .boolean(let completed) = measured.last!.value else { return HabitStatus(.missing, included: true) }
            return HabitStatus(completed ? .success : .unsuccessful, credit: completed ? 1 : 0, included: true)
        }
        let actual = measured.reduce(Decimal.zero) { total, fact in
            if case .amount(let value) = fact.value { return total + value }; return total
        }
        if config.tracking.comparison == .atMost && isOpen {
            return HabitStatus(.provisional, actual: actual)
        }
        let qualified = config.tracking.qualifies(actual)
        let partial = config.tracking.comparison == .atLeast ? min(1, max(0, actual / config.tracking.target)) : 0
        return HabitStatus(qualified ? .success : .unsuccessful, actual: actual, credit: qualified ? 1 : partial, included: true)
    }
    public func progress(on day: CalendarDay, boundary: CalendarDay = .today) throws -> Decimal? {
        var numerator = Decimal.zero; var denominator = Decimal.zero
        for habit in habits {
            // Ordinary children and conditional rows are represented by their root,
            // rather than counted again as independent daily goals.
            if relationships.contains(where: { $0.childID == habit.id && $0.effective.contains(day) }) { continue }
            let status = try status(habitID: habit.id, on: day, boundary: boundary)
            guard status.included, let config = habit.configuration(on: day) else { continue }
            let weight = Decimal(weightedProgress ? config.importance.weight : 1)
            numerator += status.credit * weight; denominator += weight
        }
        for task in tasks where task.day == day && !task.archived && day <= boundary {
            denominator += 1; if task.done { numerator += 1 }
        }
        return denominator == 0 ? nil : numerator / denominator
    }
    public mutating func createHabit(_ config: HabitConfiguration) throws -> UUID {
        try config.validate()
        let habit = Habit(configuration: config); habits.append(habit); return habit.id
    }
    public mutating func editHabit(_ id: UUID, configuration: HabitConfiguration, effectiveFrom day: CalendarDay) throws {
        guard let i = habits.firstIndex(where: { $0.id == id }) else { throw PlannerError.missing("Habit not found") }
        guard let old = habits[i].configurations.last, day >= old.effective.start else { throw PlannerError.conflict("Edit cannot precede the latest configuration") }
        var next = configuration; next.id = UUID(); next.effective = DayRange(start: day)
        try next.validate()
        guard !observations.contains(where: { $0.configurationID == old.id && $0.day >= day }) else {
            throw PlannerError.conflict("Existing observations use this plan on or after the selected date. Choose a date after the latest recorded occurrence to retain its history.")
        }
        if day == old.effective.start {
            guard !observations.contains(where: { $0.configurationID == old.id }) else {
                throw PlannerError.conflict("This configuration already has observations. Edit from a later day to retain its history.")
            }
            habits[i].configurations.removeLast()
        } else { habits[i].configurations[habits[i].configurations.count - 1].effective.endExclusive = day }
        habits[i].configurations.append(next)
    }
    public mutating func setArchived(_ id: UUID, archived: Bool, from day: CalendarDay) throws {
        guard let i = habits.firstIndex(where: { $0.id == id }) else { throw PlannerError.missing("Habit not found") }
        if let last = habits[i].lifecycle.last, day < last.day { throw PlannerError.conflict("Lifecycle changes must be chronological") }
        habits[i].lifecycle.append(LifecycleChange(day: day, archived: archived))
    }
    public mutating func record(habitID: UUID, on day: CalendarDay, value: ObservationValue, supersedes: UUID? = nil,
                                note: String = "", boundary: CalendarDay = .today, occurrenceMinute: Int? = nil,
                                correctionReason: CorrectionReason? = nil) throws {
        guard day <= boundary else { throw PlannerError.invalid("Cannot record future performance") }
        guard let habit = habits.first(where: { $0.id == habitID }), let config = habit.configuration(on: day) else { throw PlannerError.missing("No configuration for this date") }
        let state = try status(habitID: habitID, on: day, boundary: boundary)
        if supersedes == nil {
            guard !state.isRoutineContainer else { throw PlannerError.conflict("A routine is completed by its applicable steps, not by an independent observation") }
            guard !config.closesByChecklist else { throw PlannerError.conflict("Complete this item using its checklist") }
            guard state.outcome != .blocked, state.outcome != .notScheduled else { throw PlannerError.conflict("This occurrence is not available") }
        }
        if let occurrenceMinute, !(0..<1440).contains(occurrenceMinute) { throw PlannerError.invalid("Invalid occurrence time") }
        switch value {
        case .boolean:
            guard config.tracking.mode == .checkbox || config.tracking.mode == .avoidance else { throw PlannerError.invalid("This habit requires a number") }
        case .amount(let number):
            guard !number.isNaN, number >= 0, number <= Decimal(1_000_000_000_000),
                  config.tracking.mode != .checkbox, config.tracking.mode != .avoidance else { throw PlannerError.invalid("Invalid measured value") }
            if config.tracking.mode == .counter || config.tracking.mode == .duration {
                var n = number; var rounded = Decimal(); NSDecimalRound(&rounded, &n, 0, .plain)
                guard n == rounded else { throw PlannerError.invalid("Use whole counts or duration seconds") }
            }
        case .skipped, .void: break
        }
        var reason = correctionReason
        var context = config
        var relationship = relationships.first { $0.childID == habitID && $0.effective.contains(day) }
        if let supersedes {
            guard let previous = observations.first(where: { $0.id == supersedes }), previous.habitID == habitID,
                  !observations.contains(where: { $0.supersedes == supersedes }) else {
                throw PlannerError.conflict("Only the current leaf of an existing observation chain can be corrected")
            }
            if previous.day != day {
                guard !state.isRoutineContainer, state.outcome != .blocked, state.outcome != .notScheduled else { throw PlannerError.conflict("The corrected date is not an available occurrence") }
                reason = reason ?? .correctDate
            } else {
                context = previous.contextConfiguration ?? config
                relationship = previous.contextRelationship ?? relationship
                reason = reason ?? (value == .void ? .reversal : .correctValue)
            }
            if value != .void && value != .skipped {
                let previousMode = previous.contextConfiguration?.tracking.mode ?? habit.configurations.first(where: { $0.id == previous.configurationID })?.tracking.mode
                guard previousMode == config.tracking.mode else { throw PlannerError.conflict("A correction cannot cross a tracking-mode boundary") }
            }
        } else if value == .void { throw PlannerError.invalid("Void must correct an existing observation") }
        if reason == .reversal || reason == .duplicateEntry {
            guard value == .void else { throw PlannerError.invalid("Reversal or duplicate correction must void the record") }
        }
        observations.append(Observation(habitID: habitID, configurationID: config.id, day: day,
                                        value: value, timezone: config.schedule.timezone, supersedes: supersedes, note: note,
                                        occurrenceMinute: occurrenceMinute, correctionReason: reason,
                                        contextConfiguration: context, contextRelationship: relationship))
    }
    public mutating func addRelationship(_ relationship: Relationship) throws {
        if relationship.kind == .routineStep, observations.contains(where: { $0.habitID == relationship.parentID && $0.day >= relationship.effective.start }) {
            throw PlannerError.conflict("Choose a routine conversion date after the parent's latest observation to preserve its history")
        }
        var candidate = self; candidate.relationships.append(relationship); try candidate.validate(); self = candidate
    }
    public mutating func deleteHabit(_ id: UUID, includingDescendants: Bool) throws {
        var deleting: Set<UUID> = [id]
        var pending = [id]
        while let parent = pending.popLast() {
            for relation in relationships where relation.parentID == parent {
                if deleting.insert(relation.childID).inserted { pending.append(relation.childID) }
            }
        }
        if deleting.count > 1 && !includingDescendants { throw PlannerError.conflict("Explicitly include dependent habits in permanent deletion") }
        habits.removeAll { deleting.contains($0.id) }; observations.removeAll { deleting.contains($0.habitID) }
        relationships.removeAll { deleting.contains($0.parentID) || deleting.contains($0.childID) }
        checklist.removeAll { deleting.contains($0.habitID) }; reminders.removeAll { deleting.contains($0.habitID) }
        attempts.removeAll { deleting.contains($0.habitID) }
    }
    public mutating func restartGrowth(habitID: UUID, on day: CalendarDay, cue: String, enjoyment: String) throws {
        guard let habit = habits.first(where: { $0.id == habitID }), habit.configuration(on: day) != nil, !habit.isArchived(on: day) else { throw PlannerError.missing("Habit is inactive on this date") }
        guard cue.trimmingCharacters(in: .whitespacesAndNewlines).count <= 120,
              ["","yes","tolerated","no"].contains(enjoyment) else { throw PlannerError.invalid("Use a cue up to 120 characters and choose yes, tolerated or no") }
        let open = attempts.filter { $0.endExclusive == nil }
        guard open.contains(where: { $0.habitID == habitID }) || open.count < 3 else { throw PlannerError.conflict("Grow at most three routines at once") }
        if let i = attempts.lastIndex(where: { $0.habitID == habitID && $0.endExclusive == nil }) {
            guard day > attempts[i].start else { throw PlannerError.conflict("Restart must follow the previous attempt start") }
            attempts[i].endExclusive = day
        }
        var attempt = GrowthAttempt(habitID: habitID, start: day); attempt.cue = cue; attempt.enjoyment = enjoyment
        attempts.append(attempt)
    }
    public mutating func toggleChecklist(_ id: UUID, on day: CalendarDay) throws {
        guard let i = checklist.firstIndex(where: { $0.id == id && $0.effective.contains(day) }) else { throw PlannerError.missing("Checklist item is unavailable") }
        guard day <= .today else { throw PlannerError.invalid("Cannot complete future checklist items") }
        let habitID = checklist[i].habitID
        let before = try status(habitID: habitID, on: day)
        guard before.outcome != .blocked, before.outcome != .notScheduled, !before.isRoutineContainer,
              let config = habits.first(where: { $0.id == habitID })?.configuration(on: day) else { throw PlannerError.conflict("This checklist occurrence is not available") }
        var candidate = self
        if candidate.checklist[i].checkedDays.contains(day) { candidate.checklist[i].checkedDays.remove(day) } else { candidate.checklist[i].checkedDays.insert(day) }
        if config.closesByChecklist {
            let allDone = candidate.checklist.filter { $0.habitID == habitID && $0.effective.contains(day) }.allSatisfy { $0.checkedDays.contains(day) }
            let relation = relationships.first { $0.childID == habitID && $0.effective.contains(day) }
            if allDone && before.outcome != .success {
                candidate.observations.append(Observation(habitID: habitID, configurationID: config.id, day: day, value: .boolean(true), timezone: config.schedule.timezone, note: "Closed by checklist", contextConfiguration: config, contextRelationship: relation))
            } else if !allDone && before.outcome == .success {
                for fact in candidate.leaves(habitID: habitID, on: day) where fact.value == .boolean(true) {
                    candidate.observations.append(Observation(habitID: habitID, configurationID: fact.configurationID, day: day, value: .void, timezone: fact.timezone, supersedes: fact.id, note: "Reopened by checklist", correctionReason: .reversal, contextConfiguration: fact.contextConfiguration, contextRelationship: fact.contextRelationship))
                }
            }
        }
        try candidate.validate(); self = candidate
    }
}
