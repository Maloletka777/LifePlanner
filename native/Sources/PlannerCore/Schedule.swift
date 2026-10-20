import Foundation

public enum ScheduleKind: String, Codable, CaseIterable, Sendable {
    case daily, selectedWeekdays, everyNDays, weekly, monthly, yearly, timesPerWeek, timesPerMonth, timesPerYear
    public var label: String {
        switch self {
        case .daily: return "Every day"
        case .selectedWeekdays: return "Selected weekdays"
        case .everyNDays: return "Every N days"
        case .weekly: return "Weekly"
        case .monthly: return "Monthly"
        case .yearly: return "Yearly"
        case .timesPerWeek: return "Times per week"
        case .timesPerMonth: return "Times per month"
        case .timesPerYear: return "Times per year"
        }
    }
}
public struct Schedule: Codable, Equatable, Sendable {
    public var kind: ScheduleKind = .daily
    public var timezone: String = TimeZone.current.identifier
    public var weekdays: Set<Int> = [1,2,3,4,5]
    public var intervalDays = 2
    public var anchor: CalendarDay = .today
    public var weekday = 1
    public var monthDay = 1
    public var monthNumber = 1
    public var targetCount = 3
    public var weekStart = 1
    public init() {}
    public func validate() throws {
        guard TimeZone(identifier: timezone) != nil else { throw PlannerError.invalid("Unknown time zone") }
        guard intervalDays > 0, intervalDays <= 36500, (1...7).contains(weekday), (1...7).contains(weekStart),
              (1...31).contains(monthDay), (1...12).contains(monthNumber),
              weekdays.allSatisfy({ (1...7).contains($0) }), !weekdays.isEmpty else {
            throw PlannerError.invalid("Invalid schedule settings")
        }
        let maxCount = kind == .timesPerWeek ? 7 : kind == .timesPerMonth ? 31 : 366
        guard targetCount > 0, targetCount <= maxCount else { throw PlannerError.invalid("Invalid period target") }
        if kind == .yearly {
            let reference = try CalendarDay(2024, monthNumber, 1)
            guard monthDay <= reference.daysInMonth else { throw PlannerError.invalid("Invalid yearly date") }
        }
    }
    public func occurrence(on day: CalendarDay) throws -> ScheduleOccurrence? {
        try validate()
        switch kind {
        case .daily: return .day(day)
        case .selectedWeekdays: return weekdays.contains(day.isoWeekday) ? .day(day) : nil
        case .everyNDays:
            let n = anchor.distance(to: day)
            return n >= 0 && n % intervalDays == 0 ? .day(day) : nil
        case .weekly: return day.isoWeekday == weekday ? .day(day) : nil
        case .monthly: return day.day == min(monthDay, day.daysInMonth) ? .day(day) : nil
        case .yearly: return day.month == monthNumber && day.day == min(monthDay, day.daysInMonth) ? .day(day) : nil
        case .timesPerWeek:
            let offset = (day.isoWeekday - weekStart + 7) % 7
            let start = try day.adding(days: -offset)
            return .period(start: start, endExclusive: try start.adding(days: 7), target: targetCount)
        case .timesPerMonth:
            let start = try CalendarDay(day.year, day.month, 1)
            return .period(start: start, endExclusive: try start.adding(days: start.daysInMonth), target: targetCount)
        case .timesPerYear:
            return .period(start: try CalendarDay(day.year, 1, 1), endExclusive: try CalendarDay(day.year + 1, 1, 1), target: targetCount)
        }
    }
}
public enum ScheduleOccurrence: Equatable, Sendable {
    case day(CalendarDay)
    case period(start: CalendarDay, endExclusive: CalendarDay, target: Int)
    public var range: DayRange {
        switch self {
        case .day(let day): return DayRange(start: day, endExclusive: try? day.adding(days: 1))
        case .period(let start, let end, _): return DayRange(start: start, endExclusive: end)
        }
    }
}
