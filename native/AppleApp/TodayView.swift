import SwiftUI
import PlannerCore

struct TodayView: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedDate = Date()
    @State private var creatingHabit = false
    @State private var creatingTask = false
    @State private var journalOpen = false
    @State private var calendarOpen = false
    private var day: CalendarDay { CalendarDay(date: selectedDate) }
    private var week: [Date] {
        var calendar = Calendar.current; calendar.firstWeekday = 2
        let start = calendar.dateInterval(of: .weekOfYear, for: selectedDate)?.start ?? selectedDate
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                weekHeader
                ScrollView {
                    VStack(spacing: 16) {
                        DayAgenda(day: day, addTask: { creatingTask = true })
                        dailyFocus
                    }.padding(.horizontal, 16).padding(.bottom, 90)
                }
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
                    Menu {
                        Button("New habit", systemImage: "leaf") { creatingHabit = true }
                        Button("New task", systemImage: "checklist") { creatingTask = true }
                    } label: {
                        Image(systemName: "plus").font(.title2.weight(.medium))
                            .foregroundStyle(Palette.sage).frame(width: 56, height: 56).plannerGlass()
                    }
                    .accessibilityLabel("Add")
                    .padding(.trailing, 20).padding(.bottom, 10)
                }
            }
            .background(Palette.background)
            .foregroundStyle(Palette.ink)
            .navigationTitle(selectedDate.formatted(.dateTime.month(.wide).year()))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { calendarOpen = true } label: { Label("Choose date", systemImage: "calendar") }
                        .popover(isPresented: $calendarOpen) {
                            DatePicker("Your day", selection: $selectedDate, displayedComponents: .date)
                                .datePickerStyle(.graphical).padding().frame(width: 320)
                                .presentationCompactAdaptation(.popover)
                                .onChange(of: selectedDate) { _, _ in calendarOpen = false }
                        }
                }
            }
            .sheet(isPresented: $creatingHabit) { HabitEditor(day: day) }
            .sheet(isPresented: $creatingTask) { TaskEditor(day: day) }
            .sheet(isPresented: $journalOpen) { JournalEditor(day: day) }
        }
    }
    private var weekHeader: some View {
        VStack(spacing: 6) {
            HStack {
                Button { moveDay(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    .accessibilityLabel("Previous day")
                Spacer()
                Button("Today") { select(Date()) }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                Spacer()
                Button { moveDay(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                    .accessibilityLabel("Next day")
            }
            HStack(spacing: 0) {
                ForEach(week, id: \.self) { date in
                    let selected = Calendar.current.isDate(date, inSameDayAs: selectedDate)
                    Button { select(date) } label: {
                        VStack(spacing: 6) {
                            Text(date.formatted(.dateTime.weekday(.narrow))).font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
                            Text(date.formatted(.dateTime.day())).font(.body.weight(.bold))
                                .frame(minWidth: 38, minHeight: 38)
                                .foregroundStyle(selected ? Palette.onAccent : Palette.ink)
                                .background { if selected { Circle().fill(Palette.sage) } }
                        }.frame(maxWidth: .infinity).padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(date.formatted(date: .complete, time: .omitted))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 14)
        .background(Palette.header)
    }
    private var dailyFocus: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Daily Focus", systemImage: "square.and.pencil").font(.headline)
            if let progress = try? model.snapshot.progress(on: day) {
                ProgressView(value: NSDecimalNumber(decimal: progress).doubleValue)
                Text("\(NSDecimalNumber(decimal: progress * 100).intValue)% of scheduled progress")
                    .font(.caption).foregroundStyle(Palette.muted)
            }
            if let entry = model.snapshot.journal.first(where: { $0.day == day }), !entry.focus.isEmpty {
                Text(entry.focus).font(.body.weight(.medium))
            }
            Button("Daily focus & notes", systemImage: "square.and.pencil") { journalOpen = true }.frame(minHeight: 44)
            NavigationLink("Daily Focus cards & history") { FocusHistoryView(day: day) }.frame(minHeight: 44)
            ForEach(model.snapshot.focusEntries.filter { $0.isVisible(on: day) }) { focus in
                NavigationLink(focus.title) { FocusDetail(focusID: focus.id) }.frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 24))
    }
    private func select(_ date: Date) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) { selectedDate = date }
    }
    private func moveDay(_ offset: Int) {
        select(Calendar.current.date(byAdding: .day, value: offset, to: selectedDate) ?? selectedDate)
    }
}

private struct DayAgenda: View {
    private struct Entry: Identifiable {
        let id: UUID
        let minute: Int
        var habit: Habit? = nil
        var task: PlannerTask? = nil
    }
    @EnvironmentObject private var model: PlannerModel
    let day: CalendarDay
    let addTask: () -> Void
    private var habits: [Habit] {
        model.snapshot.habits.filter { $0.configuration(on: day) != nil && model.status($0, day: day).outcome != .notScheduled }
    }
    private var tasks: [PlannerTask] { model.snapshot.tasks.filter { $0.day == day && !$0.archived } }
    private var untimedHabits: [Habit] { habits.filter { $0.configuration(on: day)?.plannedMinute == nil } }
    private var untimedTasks: [PlannerTask] { tasks.filter { $0.plannedMinute == nil } }
    private var hasTimedItems: Bool {
        habits.contains { $0.configuration(on: day)?.plannedMinute != nil } || tasks.contains { $0.plannedMinute != nil }
    }
    var body: some View {
        VStack(spacing: 0) {
            if !untimedHabits.isEmpty || !untimedTasks.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Anytime").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.muted)
                    ForEach(untimedHabits) { habit in HabitRow(habit: habit, day: day) }
                    ForEach(untimedTasks) { task in TaskRow(task: task, day: day) }
                }.padding(20)
                Divider().overlay(Palette.line)
            }
            TimelineView(.periodic(from: .now, by: 60)) { context in
                VStack(spacing: 0) {
                    ForEach(0..<24, id: \.self) { hour in hourRow(hour, now: context.date) }
                    HStack { Text("24:00").font(.caption.monospacedDigit()).frame(width: 52); Spacer() }
                        .foregroundStyle(Palette.muted).padding(.leading, 8).padding(.bottom, 18)
                }
                .overlay {
                    if !hasTimedItems {
                        VStack(spacing: 16) {
                            Text(habits.isEmpty && tasks.isEmpty ? "Nothing planned for this day" : "No timed items for this day")
                                .font(.headline).foregroundStyle(Palette.muted)
                            Button("Add a task", systemImage: "plus", action: addTask).font(.headline).frame(minHeight: 44)
                        }.padding(.leading, 56).padding(.horizontal, 20)
                    }
                }
            }
        }
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 28))
        .padding(.top, 16)
        .buttonStyle(.plain)
    }
    private func hourRow(_ hour: Int, now: Date) -> some View {
        let hourHabits = habits.filter { ($0.configuration(on: day)?.plannedMinute ?? -60) / 60 == hour }
            .sorted { ($0.configuration(on: day)?.plannedMinute ?? 0) < ($1.configuration(on: day)?.plannedMinute ?? 0) }
        let hourTasks = tasks.filter { ($0.plannedMinute ?? -60) / 60 == hour }
            .sorted { ($0.plannedMinute ?? 0) < ($1.plannedMinute ?? 0) }
        let habitEntries: [Entry] = hourHabits.map { habit in
            Entry(id: habit.id, minute: habit.configuration(on: day)?.plannedMinute ?? 0, habit: habit)
        }
        let taskEntries: [Entry] = hourTasks.map { task in
            Entry(id: task.id, minute: task.plannedMinute ?? 0, task: task)
        }
        let entries: [Entry] = (habitEntries + taskEntries).sorted { lhs, rhs in
            if lhs.minute != rhs.minute { return lhs.minute < rhs.minute }
            return lhs.id.uuidString < rhs.id.uuidString
        }
        let isCurrent = day == CalendarDay(date: now) && Calendar.current.component(.hour, from: now) == hour
        return HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 0) {
                Text(isCurrent ? timeLabel(minuteOfDay(now)) : timeLabel(hour * 60))
                    .font(.caption2.weight(isCurrent ? .bold : .medium).monospacedDigit())
                    .foregroundStyle(isCurrent ? Palette.sage : Palette.muted)
                    .opacity(hour % 4 == 0 || isCurrent || !hourHabits.isEmpty || !hourTasks.isEmpty ? 1 : 0)
                    .frame(width: 52, alignment: .trailing)
            }
            VStack(spacing: 8) {
                if isCurrent { Rectangle().fill(Palette.sage.opacity(0.6)).frame(height: 1).accessibilityHidden(true) }
                ForEach(entries) { entry in
                    Group {
                        if let habit = entry.habit { HabitRow(habit: habit, day: day) }
                        if let task = entry.task { TaskRow(task: task, day: day) }
                    }.padding(12).background(Palette.header, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 14, alignment: .topLeading)
            .padding(.leading, 12).padding(.bottom, 6)
            .overlay(alignment: .leading) { Rectangle().fill(Palette.line).frame(width: 1).accessibilityHidden(true) }
        }
        .padding(.leading, 8).padding(.trailing, 16)
    }
}

struct HabitRow: View {
    @EnvironmentObject private var model: PlannerModel
    let habit: Habit
    let day: CalendarDay
    var body: some View {
        if let config = habit.configuration(on: day) {
            let status = model.status(habit, day: day)
            NavigationLink {
                HabitDetail(habitID: habit.id, initialDay: day)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: config.symbol).font(.title2).foregroundStyle(Palette.accent(config.accent)).frame(minWidth: 32)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(config.name).font(.headline)
                        HStack {
                            Text(config.category)
                            if let minute = config.plannedMinute { Text(timeLabel(minute)) }
                            if let duration = config.durationMinutes { Text("\(duration) min") }
                        }.font(.caption).foregroundStyle(.secondary)
                        if let target = status.periodTarget { Text("\(status.periodSuccesses) / \(target) this period").font(.caption) }
                    }
                    Spacer()
                    Image(systemName: status.outcome == .success ? "checkmark.circle.fill" : status.outcome == .blocked ? "lock.circle" : "circle")
                        .foregroundStyle(status.outcome == .success ? Palette.sage : .secondary)
                        .accessibilityLabel(status.outcome.rawValue)
                }.padding(.vertical, 5)
            }
        }
    }
}

struct TaskRow: View {
    @EnvironmentObject private var model: PlannerModel
    let task: PlannerTask
    let day: CalendarDay
    var body: some View {
        HStack {
            Button {
                model.change { s in if let i = s.tasks.firstIndex(where: { $0.id == task.id }) { s.tasks[i].done.toggle() } }
            } label: { Image(systemName: task.done ? "checkmark.circle.fill" : "circle").font(.title2).frame(width: 44, height: 44).contentShape(Rectangle()) }
                .buttonStyle(.borderless).disabled(day > .today).accessibilityLabel(task.done ? "Mark incomplete" : "Complete task")
            NavigationLink { TaskDetail(taskID: task.id) } label: {
                VStack(alignment: .leading) {
                    Text(task.title)
                    if let minute = task.plannedMinute { Text(timeLabel(minute)).font(.caption).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }
        }
    }
}

func timeLabel(_ minute: Int) -> String { String(format: "%02d:%02d", minute / 60, minute % 60) }

struct JournalEditor: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let day: CalendarDay
    @State private var focus = ""
    @State private var note = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("One thing to focus on") { TextField("Daily focus", text: $focus, axis: .vertical) }
                Section("Journal") { TextEditor(text: $note).frame(minHeight: 180).accessibilityLabel("Journal notes") }
            }.plannerListSurface().navigationTitle(day.description)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") {
                        if model.change({ s in
                            var entry = JournalEntry(day: day); entry.focus = focus; entry.note = note
                            s.journal.removeAll { $0.day == day }; s.journal.append(entry)
                        }) { dismiss() }
                    } }
                }
                .onAppear { let existing = model.snapshot.journal.first { $0.day == day }; focus = existing?.focus ?? ""; note = existing?.note ?? "" }
        }.frame(minWidth: 300, minHeight: 400)
    }
}
