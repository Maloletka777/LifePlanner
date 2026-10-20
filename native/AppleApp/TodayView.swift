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
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
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
        let block: DayBlock
        let minute: Int?
        let title: String
        let complete: Bool
        var habit: Habit? = nil
        var task: PlannerTask? = nil
    }
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var collapsed: Set<DayBlock> = []
    let day: CalendarDay
    let addTask: () -> Void
    private var entries: [Entry] {
        let habits: [Entry] = model.snapshot.habits.compactMap { habit in
            guard let config = habit.configuration(on: day), model.status(habit, day: day).outcome != .notScheduled else { return nil }
            return Entry(id: habit.id, block: config.block, minute: config.plannedMinute, title: config.name,
                         complete: model.status(habit, day: day).outcome == .success, habit: habit)
        }
        let tasks: [Entry] = model.snapshot.tasks.filter { $0.day == day && !$0.archived }.map {
            Entry(id: $0.id, block: $0.block, minute: $0.plannedMinute, title: $0.title, complete: $0.done, task: $0)
        }
        return (habits + tasks).sorted {
            if $0.minute != $1.minute { return ($0.minute ?? 1440) < ($1.minute ?? 1440) }
            return $0.id.uuidString < $1.id.uuidString
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                nowCard(context.date)
            }
            HStack {
                Text(day == .today ? "DAY" : "THE DAY AHEAD").font(.caption2.weight(.semibold)).tracking(1)
                ProgressView(value: entries.isEmpty ? 0 : Double(entries.filter(\.complete).count) / Double(entries.count))
                Text("\(entries.filter(\.complete).count) / \(entries.count)").font(.caption.monospacedDigit())
            }.foregroundStyle(Palette.muted).padding(.vertical, 14)
            if entries.isEmpty {
                Text("Nothing planned for this day").font(.subheadline).foregroundStyle(Palette.muted).padding(.vertical, 8)
            }
            ForEach([DayBlock.anytime, .morning, .afternoon, .evening], id: \.self) { block in
                let items = entries.filter { $0.block == block }
                if block != .anytime || !items.isEmpty {
                    HStack(spacing: 8) {
                        Button {
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                                if collapsed.contains(block) { collapsed.remove(block) } else { collapsed.insert(block) }
                            }
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: collapsed.contains(block) ? "chevron.right" : "chevron.down").font(.caption2)
                                Text(block.rawValue.capitalized).font(.headline)
                                if !items.isEmpty { Text("\(items.filter(\.complete).count) / \(items.count)").font(.caption).foregroundStyle(Palette.muted) }
                            }.frame(minHeight: 44)
                        }.accessibilityLabel(block.rawValue.capitalized)
                        Rectangle().fill(Palette.ink.opacity(0.09)).frame(height: 1)
                        Button(action: addTask) { Image(systemName: "plus").frame(width: 44, height: 44) }
                            .accessibilityLabel("Add to " + block.rawValue)
                    }.padding(.top, 8)
                    if !collapsed.contains(block) {
                        ForEach(items) { item in plate(item) }
                    }
                }
            }
        }
        .foregroundStyle(Palette.ink).padding(.top, 12).buttonStyle(.plain)
    }
    @ViewBuilder private func nowCard(_ now: Date) -> some View {
        if day == CalendarDay(date: now), let next = entries.first(where: { !$0.complete && ($0.minute ?? -1) >= minuteOfDay(now) }) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("NEXT").font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(Palette.muted)
                    Text(next.title).font(.title3.weight(.semibold))
                }
                Spacer()
                if let minute = next.minute { Text(timeLabel(minute)).font(.subheadline.monospacedDigit()).foregroundStyle(Palette.muted) }
            }.padding(16).background(Palette.hero, in: RoundedRectangle(cornerRadius: 12))
        }
    }
    private func plate(_ item: Entry) -> some View {
        HStack(spacing: 0) {
            if item.habit?.configuration(on: day)?.importance == .high { Rectangle().fill(Palette.high).frame(width: 3) }
            if item.habit?.configuration(on: day)?.importance == .critical { Rectangle().fill(Palette.overdue).frame(width: 3) }
            Group {
                if let habit = item.habit { HabitRow(habit: habit, day: day) }
                if let task = item.task { TaskRow(task: task, day: day) }
            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
        }.background(Palette.surface, in: RoundedRectangle(cornerRadius: 12)).clipShape(RoundedRectangle(cornerRadius: 12))
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
                    Image(systemName: config.symbol).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.surface).frame(width: 32, height: 32).background(Palette.accent(config.accent), in: RoundedRectangle(cornerRadius: 8))
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
                        .foregroundStyle(status.outcome == .success ? Palette.done : Palette.muted)
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
            } label: { Image(systemName: task.done ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(task.done ? Palette.done : Palette.muted).frame(width: 44, height: 44).contentShape(Rectangle()) }
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
