import Foundation

public struct PlannedReminder: Identifiable, Equatable, Sendable {
    public var id: String
    public var habitID: UUID
    public var title: String
    public var fireAt: Date
}
extension PlannerSnapshot {
    /// iOS has a finite pending notification budget. Reserve capacity by taking the earliest 60.
    /// A bounded horizon is refreshed when the app becomes active or its data changes.
    public func reminderPlan(now: Date = Date(), horizonDays: Int = 30, limit: Int = 60) throws -> [PlannedReminder] {
        guard (1...366).contains(horizonDays), (0...60).contains(limit) else { throw PlannerError.invalid("Invalid reminder horizon") }
        var result: [PlannedReminder] = []
        for reminder in reminders where reminder.enabled {
            guard let habit = habits.first(where: { $0.id == reminder.habitID }) else { continue }
            // Configuration time zones may change within the horizon; evaluate each configuration separately.
            for config in habit.configurations {
                guard let timezone = TimeZone(identifier: config.schedule.timezone) else { continue }
                let first = CalendarDay(date: now, timezone: timezone)
                for offset in 0..<horizonDays {
                    let day = try first.adding(days: offset)
                    guard config.effective.contains(day), !habit.isArchived(on: day),
                          try config.schedule.occurrence(on: day) != nil else { continue }
                    let status = try status(habitID: habit.id, on: day, boundary: day)
                    if status.outcome == .success || status.outcome == .skipped || status.outcome == .blocked { continue }
                    var calendar = CalendarDay.calendar; calendar.timeZone = timezone
                    guard let midnight = calendar.date(from: DateComponents(year: day.year, month: day.month, day: day.day)),
                          let fireAt = calendar.nextDate(after: midnight.addingTimeInterval(-1), matching: DateComponents(hour: reminder.minute / 60, minute: reminder.minute % 60), matchingPolicy: .nextTime, repeatedTimePolicy: .first),
                          CalendarDay(date: fireAt, timezone: timezone) == day, fireAt > now else { continue }
                    result.append(PlannedReminder(id: "liveplanner.\(reminder.id).\(day)", habitID: habit.id, title: config.name, fireAt: fireAt))
                }
            }
        }
        return Array(result.sorted { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }.prefix(limit))
    }
}
