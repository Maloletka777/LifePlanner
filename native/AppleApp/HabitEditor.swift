import SwiftUI
import PlannerCore

struct HabitEditor: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let day: CalendarDay
    var habitID: UUID? = nil
    @State private var config = HabitConfiguration(name: "", from: .today)
    @State private var targetText = "1"
    @State private var hasTime = false
    @State private var plannedTime = Date()
    @State private var hasDuration = false
    @State private var duration = 30
    @State private var effectiveDate = Date()
    @State private var hasReminder = false
    @State private var reminderTime = Date()
    @State private var checklistText = ""
    private let symbols = ["leaf.fill", "figure.walk", "book.fill", "drop.fill", "heart.fill", "brain.head.profile", "moon.fill", "dumbbell.fill", "pencil", "sun.max.fill"]
    var body: some View {
        NavigationStack {
            Form {
                InlinePlannerError()
                Section("Identity") {
                    TextField("Habit title", text: $config.name)
                    TextField("Description", text: $config.detail, axis: .vertical)
                    TextField("Category", text: $config.category)
                    Picker("Symbol", selection: $config.symbol) { ForEach(symbols, id: \.self) { Image(systemName: $0).tag($0) } }
                    Picker("Colour", selection: $config.accent) {
                        ForEach(["sage","blue","orange","purple","pink"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Picker("Importance", selection: $config.importance) { ForEach(Importance.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) } }
                }
                Section(habitID == nil ? "Starts on" : "Change applies from") {
                    DatePicker("Effective date", selection: $effectiveDate, displayedComponents: .date)
                    if habitID != nil { Text("Earlier configurations and observations are retained. Changes cannot overwrite a configuration already used by observations on its first day.").font(.caption).foregroundStyle(.secondary) }
                }
                Section("Schedule") {
                    Picker("Repeat", selection: $config.schedule.kind) { ForEach(ScheduleKind.allCases, id: \.self) { Text($0.label).tag($0) } }
                    TextField("Time zone", text: $config.schedule.timezone)
                        .autocorrectionDisabled()
                    switch config.schedule.kind {
                    case .selectedWeekdays:
                        ForEach(1...7, id: \.self) { weekday in
                            Toggle(weekdayName(weekday), isOn: Binding(get: { config.schedule.weekdays.contains(weekday) }, set: {
                                if $0 { config.schedule.weekdays.insert(weekday) } else { config.schedule.weekdays.remove(weekday) }
                            }))
                        }
                    case .everyNDays:
                        Stepper("Every \(config.schedule.intervalDays) days", value: $config.schedule.intervalDays, in: 1...365)
                        DatePicker("Anchor", selection: Binding(get: { config.schedule.anchor.date() }, set: { config.schedule.anchor = CalendarDay(date: $0) }), displayedComponents: .date)
                    case .weekly:
                        Picker("Weekday", selection: $config.schedule.weekday) { ForEach(1...7, id: \.self) { Text(weekdayName($0)).tag($0) } }
                    case .monthly:
                        Stepper("Day \(config.schedule.monthDay)", value: $config.schedule.monthDay, in: 1...31)
                        Text("Shorter months use their last day.").font(.caption)
                    case .yearly:
                        Stepper("Month \(config.schedule.monthNumber)", value: $config.schedule.monthNumber, in: 1...12)
                        Stepper("Day \(config.schedule.monthDay)", value: $config.schedule.monthDay, in: 1...31)
                    case .timesPerWeek, .timesPerMonth, .timesPerYear:
                        Stepper("Target: \(config.schedule.targetCount)", value: $config.schedule.targetCount, in: 1...(config.schedule.kind == .timesPerWeek ? 7 : config.schedule.kind == .timesPerMonth ? 31 : 366))
                        if config.schedule.kind == .timesPerWeek {
                            Picker("Week starts", selection: $config.schedule.weekStart) { ForEach(1...7, id: \.self) { Text(weekdayName($0)).tag($0) } }
                        }
                    case .daily: EmptyView()
                    }
                }
                Section("Tracking") {
                    Picker("Measure", selection: $config.tracking.mode) { ForEach(TrackingMode.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) } }
                    if config.tracking.mode != .checkbox && config.tracking.mode != .avoidance {
                        TextField(config.tracking.mode == .duration ? "Target in seconds" : "Target", text: $targetText)
                        Picker("Comparison", selection: $config.tracking.comparison) {
                            Text("At least").tag(Comparison.atLeast); Text("At most").tag(Comparison.atMost); Text("Exactly").tag(Comparison.equal)
                        }
                        TextField("Unit", text: $config.tracking.unit)
                    }
                    if config.tracking.mode == .checkbox {
                        Toggle("Complete when all checklist items are checked", isOn: $config.closesByChecklist)
                    }
                    if habitID == nil { TextField("Checklist — one item per line", text: $checklistText, axis: .vertical) }
                    if config.tracking.mode == .avoidance { Text("Record success explicitly. An empty day is missing information, never assumed success.").font(.caption) }
                }
                Section("Place in your day") {
                    Picker("Part of day", selection: $config.block) { ForEach(DayBlock.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) } }
                    Toggle("Planned time", isOn: $hasTime)
                    if hasTime { DatePicker("Time", selection: $plannedTime, displayedComponents: .hourAndMinute) }
                    Toggle("Planned duration", isOn: $hasDuration)
                    if hasDuration { Stepper("\(duration) minutes", value: $duration, in: 1...1440) }
                }
                Section("Reminder") {
                    Toggle("Reminder enabled", isOn: $hasReminder)
                    if hasReminder { DatePicker("Reminder time", selection: $reminderTime, displayedComponents: .hourAndMinute) }
                    Text("Uses the schedule time zone. Grant notification permission in Settings. Reminders are refreshed when the app opens.").font(.caption)
                }
            }
            .navigationTitle(habitID == nil ? "New habit" : "Edit habit")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(config.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }.onAppear { load() }
        }.frame(minWidth: 320, minHeight: 500)
    }
    private func load() {
        effectiveDate = day.date(timezone: .current)
        config.effective = DayRange(start: day); config.schedule.anchor = day
        if let habitID, let existing = model.snapshot.habits.first(where: { $0.id == habitID })?.configuration(on: day) {
            config = existing; targetText = NSDecimalNumber(decimal: existing.tracking.target).stringValue
            hasTime = existing.plannedMinute != nil
            if let minute = existing.plannedMinute { plannedTime = timeDate(minute) }
            hasDuration = existing.durationMinutes != nil; duration = existing.durationMinutes ?? 30
            if let reminder = model.snapshot.reminders.first(where: { $0.habitID == habitID }) {
                hasReminder = reminder.enabled; reminderTime = timeDate(reminder.minute)
            }
        }
    }
    private func save() {
        let effective = CalendarDay(date: effectiveDate)
        var configuration = config
        configuration.effective = DayRange(start: effective)
        if configuration.tracking.mode != .checkbox { configuration.closesByChecklist = false }
        if configuration.tracking.mode != .checkbox && configuration.tracking.mode != .avoidance {
            guard let amount = Decimal(string: targetText, locale: Locale(identifier: "en_US_POSIX")) else { model.error = "Enter a valid numeric target using a decimal point"; return }
            configuration.tracking.target = amount
        }
        configuration.plannedMinute = hasTime ? minuteOfDay(plannedTime) : nil
        configuration.durationMinutes = hasDuration ? duration : nil
        if model.change({ s in
            let id: UUID
            if let habitID { try s.editHabit(habitID, configuration: configuration, effectiveFrom: effective); id = habitID }
            else {
                id = try s.createHabit(configuration)
                for line in checklistText.split(separator: "\n").map({ $0.trimmingCharacters(in: .whitespaces) }).filter({ !$0.isEmpty }) {
                    s.checklist.append(ChecklistItem(habitID: id, text: line, from: effective))
                }
            }
            s.reminders.removeAll { $0.habitID == id }
            if hasReminder { s.reminders.append(Reminder(habitID: id, minute: minuteOfDay(reminderTime))) }
        }) { dismiss() }
    }
}
func weekdayName(_ iso: Int) -> String { Calendar.current.weekdaySymbols[iso % 7] }
func minuteOfDay(_ date: Date) -> Int { Calendar.current.component(.hour, from: date) * 60 + Calendar.current.component(.minute, from: date) }
func timeDate(_ minute: Int) -> Date { Calendar.current.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: Date()) ?? Date() }

struct HabitsView: View {
    @EnvironmentObject private var model: PlannerModel
    @State private var archive = false
    @State private var query = ""
    @State private var create = false
    var body: some View {
        NavigationStack {
            List {
                Toggle("Show archived", isOn: $archive)
                ForEach(model.snapshot.habits.filter {
                    $0.isArchived(on: .today) == archive && (query.isEmpty || ($0.configurations.last?.name ?? "").localizedCaseInsensitiveContains(query))
                }) { habit in
                    let date = habit.configuration(on: .today) == nil ? habit.configurations[0].effective.start : .today
                    HabitRow(habit: habit, day: date)
                }
            }.navigationTitle(archive ? "Archived habits" : "Your habits")
                .searchable(text: $query)
                .toolbar { Button("Add habit", systemImage: "plus") { create = true } }
                .sheet(isPresented: $create) { HabitEditor(day: .today) }
        }
    }
}
