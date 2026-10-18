import SwiftUI
import PlannerCore

struct TodayView: View {
    @EnvironmentObject private var model: PlannerModel
    @State private var selectedDate = Date()
    @State private var creatingHabit = false
    @State private var creatingTask = false
    @State private var journalOpen = false
    private var day: CalendarDay { CalendarDay(date: selectedDate) }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker("Your day", selection: $selectedDate, displayedComponents: .date)
                    HStack {
                        Button { moveDay(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Previous day")
                        Spacer()
                        Button("Today") { selectedDate = Date() }
                        Spacer()
                        Button { moveDay(1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel("Next day")
                    }.buttonStyle(.borderless)
                }
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(day == .today ? "Make room for what matters" : "Your plan, one day at a time").font(.title2.weight(.semibold))
                        if let progress = try? model.snapshot.progress(on: day) {
                            ProgressView(value: NSDecimalNumber(decimal: progress).doubleValue)
                            Text("\(NSDecimalNumber(decimal: progress * 100).intValue)% of scheduled progress").font(.caption).foregroundStyle(.secondary)
                        } else { Text("No eligible items for this day").foregroundStyle(.secondary) }
                        let entry = model.snapshot.journal.first { $0.day == day }
                        if let focus = entry?.focus, !focus.isEmpty { Text(focus).font(.headline) }
                        Button("Daily focus & notes", systemImage: "square.and.pencil") { journalOpen = true }
                        NavigationLink("Daily Focus cards & history") { FocusHistoryView(day: day) }
                    }.padding(.vertical, 8)
                }
                let focusCards = model.snapshot.focusEntries.filter { $0.isVisible(on: day) }
                if !focusCards.isEmpty {
                    Section("Daily Focus") {
                        ForEach(focusCards) { focus in NavigationLink(focus.title) { FocusDetail(focusID: focus.id) } }
                    }
                }
                ForEach(DayBlock.allCases, id: \.self) { block in
                    let habits = model.snapshot.habits.filter {
                        guard let config = $0.configuration(on: day), config.block == block else { return false }
                        return model.status($0, day: day).outcome != .notScheduled
                    }.sorted { ($0.configuration(on: day)?.plannedMinute ?? 1440) < ($1.configuration(on: day)?.plannedMinute ?? 1440) }
                    let tasks = model.snapshot.tasks.filter { $0.day == day && !$0.archived && $0.block == block }
                        .sorted { ($0.plannedMinute ?? 1440) < ($1.plannedMinute ?? 1440) }
                    if !habits.isEmpty || !tasks.isEmpty {
                        Section(block.rawValue.capitalized) {
                            ForEach(habits) { habit in HabitRow(habit: habit, day: day) }
                            ForEach(tasks) { task in TaskRow(task: task, day: day) }
                        }
                    }
                }
                if model.snapshot.habits.isEmpty && model.snapshot.tasks.isEmpty {
                    ContentUnavailableView("A clear start", systemImage: "leaf", description: Text("Add a habit or a one-day task to shape your day."))
                }
            }
            .navigationTitle("Live Planner")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu { Button("New habit", systemImage: "leaf") { creatingHabit = true }; Button("New task", systemImage: "checklist") { creatingTask = true } }
                    label: { Label("Add", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $creatingHabit) { HabitEditor(day: day) }
            .sheet(isPresented: $creatingTask) { TaskEditor(day: day) }
            .sheet(isPresented: $journalOpen) { JournalEditor(day: day) }
        }
    }
    private func moveDay(_ offset: Int) { selectedDate = Calendar.current.date(byAdding: .day, value: offset, to: selectedDate) ?? selectedDate }
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
            } label: { Image(systemName: task.done ? "checkmark.circle.fill" : "circle").font(.title2) }
                .buttonStyle(.borderless).disabled(day > .today).accessibilityLabel(task.done ? "Mark incomplete" : "Complete task")
            NavigationLink { TaskDetail(taskID: task.id) } label: {
                VStack(alignment: .leading) {
                    Text(task.title)
                    if let minute = task.plannedMinute { Text(timeLabel(minute)).font(.caption).foregroundStyle(.secondary) }
                }
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
            }.navigationTitle(day.description)
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
