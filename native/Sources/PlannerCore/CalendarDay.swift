import Foundation

public enum PlannerError: Error, LocalizedError, Equatable {
    case invalid(String)
    case missing(String)
    case conflict(String)
    public var errorDescription: String? {
        switch self { case .invalid(let s), .missing(let s), .conflict(let s): return s }
    }
}

/// A civil Gregorian day, independent of device time zone and DST.
public struct CalendarDay: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int
    public init(_ year: Int, _ month: Int, _ day: Int) throws {
        guard (1...9999).contains(year), (1...12).contains(month), (1...31).contains(day) else {
            throw PlannerError.invalid("Invalid calendar date")
        }
        let parts = DateComponents(year: year, month: month, day: day)
        guard let date = Self.calendar.date(from: parts),
              Self.calendar.component(.year, from: date) == year,
              Self.calendar.component(.month, from: date) == month,
              Self.calendar.component(.day, from: date) == day else {
            throw PlannerError.invalid("Invalid Gregorian date")
        }
        self.year = year; self.month = month; self.day = day
    }
    public init(_ text: String) throws {
        let p = text.split(separator: "-", omittingEmptySubsequences: false)
        guard p.count == 3, p[0].count == 4, p[1].count == 2, p[2].count == 2,
              let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else {
            throw PlannerError.invalid("Expected YYYY-MM-DD")
        }
        try self.init(y, m, d)
    }
    public init(date: Date, timezone: TimeZone = .current) {
        var c = Self.calendar; c.timeZone = timezone
        let p = c.dateComponents([.year, .month, .day], from: date)
        year = p.year!; month = p.month!; day = p.day!
    }
    public static var today: Self { Self(date: Date()) }
    public var description: String { String(format: "%04d-%02d-%02d", year, month, day) }
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.description < rhs.description }
    public static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(secondsFromGMT: 0)!
        c.locale = Locale(identifier: "en_US_POSIX")
        return c
    }
    public func date(timezone: TimeZone = TimeZone(secondsFromGMT: 0)!) -> Date {
        var c = Self.calendar; c.timeZone = timezone
        return c.date(from: DateComponents(year: year, month: month, day: day, hour: 12))!
    }
    public var isoWeekday: Int { (Self.calendar.component(.weekday, from: date()) + 5) % 7 + 1 }
    public var daysInMonth: Int { Self.calendar.range(of: .day, in: .month, for: date())!.count }
    public func adding(days: Int) throws -> Self {
        guard let next = Self.calendar.date(byAdding: .day, value: days, to: date()) else {
            throw PlannerError.invalid("Date arithmetic overflow")
        }
        let result = Self(date: next, timezone: Self.calendar.timeZone)
        return try Self(result.year, result.month, result.day)
    }
    public func distance(to other: Self) -> Int {
        Self.calendar.dateComponents([.day], from: date(), to: other.date()).day!
    }
    public init(from decoder: any Decoder) throws { try self.init(decoder.singleValueContainer().decode(String.self)) }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer(); try c.encode(description)
    }
}

public struct DayRange: Codable, Equatable, Sendable {
    public var start: CalendarDay
    public var endExclusive: CalendarDay?
    public init(start: CalendarDay, endExclusive: CalendarDay? = nil) {
        self.start = start; self.endExclusive = endExclusive
    }
    public func contains(_ day: CalendarDay) -> Bool { day >= start && (endExclusive.map { day < $0 } ?? true) }
    public func validate() throws {
        if let endExclusive, endExclusive <= start { throw PlannerError.invalid("Date range must have positive length") }
    }
}
