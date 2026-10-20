import SwiftUI
import PlannerCore

struct HabitDetail: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let habitID: UUID
    let initialDay: CalendarDay
    @State private var selectedDate = Date()
    @State private var amount = "1"
    @State private var note = ""
    @State private var newChecklist = ""
    @State private var editing = false
    @State private var deleting = false
    @State private var relationship = false
    @State private var correcting: UUID?
    @State private var correctionValue = ""
    @State private var correctionBoolean = false
    @State private var correctionDate = Date()
    @State private var correctionTime = Date()
    @State private var correctionHasTime = false
    @State private var occurrenceHasTime = false
    @State private var occurrenceTime = Date()
    private var day: CalendarDay { CalendarDay(date: selectedDate) }
    private var habit: Habit? { model.snapshot.habits.first { $0.id == habitID } }
    var body: some View {
        Group {
            if let habit, let config = habit.configuration(on: day) {
                let state = model.status(habit, day: day)
                List {
                    Section {
                        DatePicker("Selected day", selection: $selectedDate, displayedComponents: .date)
                        Label(config.name, systemImage: config.symbol).font(.title2)
                        if !config.detail.isEmpty { Text(config.detail) }
                        LabeledContent("Schedule", value: config.schedule.kind.label)
                        LabeledContent("State") { Text(state.outcome.rawValue.capitalized).accessibilityIdentifier("habit.outcome") }
                        if let actual = state.actual { LabeledContent("Recorded", value: "\(actual) / \(config.tracking.target) \(config.tracking.unit)") }
                        if let target = state.periodTarget { LabeledContent("This period", value: "\(state.periodSuccesses) / \(target)") }
                        if state.isRoutineContainer { LabeledContent("Routine steps", value: "\(state.completedSteps) / \(state.applicableSteps)") }
                    }
                    if day <= .today && state.outcome != .notScheduled && state.outcome != .blocked && !state.isRoutineContainer && !config.closesByChecklist {
                        Section("Record performance") {
                            if config.tracking.mode == .checkbox || config.tracking.mode == .avoidance {
                                HStack {
                                    Button("Success", systemImage: "checkmark.circle") { record(.boolean(true)) }
                                    Spacer()
                                    Button("Not achieved", systemImage: "xmark.circle") { record(.boolean(false)) }
                                }.buttonStyle(.borderless)
                            } else {
                                TextField(config.tracking.mode == .duration ? "Seconds to add" : "Amount to add", text: $amount)
                                Button("Add measurement") {
                                    guard let value = Decimal(string: amount, locale: Locale(identifier: "en_US_POSIX")) else { model.error = "Enter a valid number"; return }
                                    record(.amount(value))
                                }
                            }
                            TextField("Optional note", text: $note, axis: .vertical)
                            Toggle("Add occurrence time", isOn: $occurrenceHasTime)
                            if occurrenceHasTime { DatePicker("Actual time", selection: $occurrenceTime, displayedComponents: .hourAndMinute) }
                            Button("Skip this occurrence") { record(.skipped) }
                        }
                    }
                    Section("Checklist") {
                        ForEach(model.snapshot.checklist.filter { $0.habitID == habitID && $0.effective.contains(day) }) { item in
                            Button {
                                model.change { try $0.toggleChecklist(item.id, on: day) }
                            } label: { Label(item.text, systemImage: item.checkedDays.contains(day) ? "checkmark.square.fill" : "square") }
                                .accessibilityLabel(item.text)
                                .disabled(day > .today || state.outcome == .blocked || state.outcome == .notScheduled || state.isRoutineContainer)
                                .contextMenu {
                                    Button("Remove from selected day", role: .destructive) {
                                        model.change { try $0.removeChecklistItem(item.id, from: day) }
                                    }
                                }
                        }
                        TextField("New checklist item", text: $newChecklist)
                        Button("Add checklist item") {
                            if model.change({ $0.checklist.append(ChecklistItem(habitID: habitID, text: newChecklist, from: day)) }) { newChecklist = "" }
                        }.disabled(newChecklist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Section("Related habits") {
                        ForEach(model.snapshot.relationships.filter { ($0.parentID == habitID || $0.childID == habitID) && $0.effective.contains(day) }) { link in
                            let other = link.parentID == habitID ? link.childID : link.parentID
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(model.snapshot.habits.first { $0.id == other }?.configuration(on: day)?.name ?? "Related habit")
                                    Text(link.kind.rawValue).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Unlink") {
                                    model.change { try $0.unlinkRelationship(link.id, from: day) }
                                }.buttonStyle(.borderless)
                            }
                        }
                        Button("Link a habit") { relationship = true }
                        NavigationLink("Convert children to a routine") { RoutineConversionView(parentID: habitID, day: day) }
                    }
                    Section("Observation history") {
                        ForEach(model.snapshot.observations.filter { $0.habitID == habitID && $0.day == day }.reversed()) { fact in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(observationLabel(fact.value)).font(.headline)
                                Text(fact.recordedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                                if !fact.note.isEmpty { Text(fact.note) }
                                if fact.supersedes != nil { Text("Correction — original retained").font(.caption) }
                                if !model.snapshot.observations.contains(where: { $0.supersedes == fact.id }) && fact.value != .void {
                                    HStack {
                                        Button("Correct") {
                                            correcting = fact.id
                                            correctionDate = fact.day.date(timezone: .current)
                                            correctionHasTime = fact.occurrenceMinute != nil
                                            correctionTime = timeDate(fact.occurrenceMinute ?? minuteOfDay(Date()))
                                            if case .amount(let n) = fact.value { correctionValue = NSDecimalNumber(decimal: n).stringValue }
                                            if case .boolean(let b) = fact.value { correctionBoolean = b }
                                        }
                                        Button("Void record", role: .destructive) { record(.void, supersedes: fact.id) }
                                    }.buttonStyle(.borderless)
                                }
                            }.padding(.vertical, 4)
                        }
                    }
                    Section("Configuration history") {
                        ForEach(habit.configurations) { version in
                            VStack(alignment: .leading) {
                                Text(version.name)
                                Text("\(version.effective.start) → \(version.effective.endExclusive?.description ?? "open") · \(version.schedule.kind.label)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Section {
                        Button(habit.isArchived(on: day) ? "Restore from selected day" : "Archive from selected day") {
                            model.change { try $0.setArchived(habitID, archived: !habit.isArchived(on: day), from: day) }
                        }
                        Button("Permanently delete habit and descendants", role: .destructive) { deleting = true }
                    }
                }
                .navigationTitle(config.name)
                .toolbar { Button("Edit") { editing = true } }
                .sheet(isPresented: $editing) { HabitEditor(day: day, habitID: habitID) }
                .sheet(isPresented: $relationship) { RelationshipEditor(parentID: habitID, day: day) }
                .sheet(isPresented: Binding(get: { correcting != nil }, set: { if !$0 { correcting = nil } })) {
                    NavigationStack {
                        Form {
                            InlinePlannerError()
                            DatePicker("Correct date", selection: $correctionDate, in: ...Date(), displayedComponents: .date)
                            Toggle("Record occurrence time", isOn: $correctionHasTime)
                            if correctionHasTime { DatePicker("Occurrence time", selection: $correctionTime, displayedComponents: .hourAndMinute) }
                            if config.tracking.mode == .checkbox || config.tracking.mode == .avoidance {
                                Toggle("Successful", isOn: $correctionBoolean)
                            } else { TextField("Correct amount", text: $correctionValue) }
                            Button("Save correction") {
                                let value: ObservationValue
                                if config.tracking.mode == .checkbox || config.tracking.mode == .avoidance { value = .boolean(correctionBoolean) }
                                else {
                                    guard let n = Decimal(string: correctionValue, locale: Locale(identifier: "en_US_POSIX")) else { model.error = "Enter a valid number"; return }
                                    value = .amount(n)
                                }
                                let targetDay = CalendarDay(date: correctionDate)
                                if model.change({ try $0.record(habitID: habitID, on: targetDay, value: value, supersedes: correcting, note: "Observation correction", occurrenceMinute: correctionHasTime ? minuteOfDay(correctionTime) : nil) }) { correcting = nil; selectedDate = correctionDate }
                            }
                        }.plannerListSurface().navigationTitle("Correct record").toolbar { Button("Cancel") { correcting = nil } }
                    }.frame(minWidth: 300, minHeight: 250)
                }
                .confirmationDialog("Permanently delete this habit, all descendants, observations and reminders?", isPresented: $deleting, titleVisibility: .visible) {
                    Button("Delete permanently", role: .destructive) {
                        if model.change({ try $0.deleteHabit(habitID, includingDescendants: true) }) { dismiss() }
                    }
                }
            } else {
                VStack {
                    DatePicker("Selected day", selection: $selectedDate, displayedComponents: .date).padding()
                    ContentUnavailableView("No configuration on this date", systemImage: "calendar")
                }
            }
        }.onAppear { selectedDate = initialDay.date(timezone: .current) }
    }
    private func record(_ value: ObservationValue, supersedes: UUID? = nil) {
        if model.change({ try $0.record(habitID: habitID, on: day, value: value, supersedes: supersedes, note: note, occurrenceMinute: occurrenceHasTime ? minuteOfDay(occurrenceTime) : nil) }) { note = "" }
    }
}

func observationLabel(_ value: ObservationValue) -> String {
    switch value { case .boolean(let success): success ? "Success" : "Not achieved"; case .amount(let n): "Recorded: \(n)"; case .skipped: "Skipped"; case .void: "Voided" }
}

struct RelationshipEditor: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let parentID: UUID
    let day: CalendarDay
    @State private var childID: UUID?
    @State private var kind: RelationshipKind = .subhabit
    var body: some View {
        NavigationStack {
            Form {
                Picker("Relationship", selection: $kind) { ForEach(RelationshipKind.allCases, id: \.self) { Text($0.label).tag($0) } }.accessibilityIdentifier("relationship.kind")
                Picker("Child habit", selection: $childID) {
                    Text("Choose a habit").tag(nil as UUID?)
                    ForEach(model.snapshot.habits.filter { $0.id != parentID }) { habit in
                        Text(habit.configurations.last?.name ?? "Habit").tag(habit.id as UUID?)
                    }
                }.accessibilityIdentifier("relationship.child")
                Text("Prerequisite: child must succeed before parent. Follow-up: parent must succeed before child. Ordinary subhabits and routine steps keep their own schedules. A routine parent is completed by its applicable steps, without an order gate.").font(.caption)
                Button("Link") {
                    guard let childID else { return }
                    let order = model.snapshot.relationships.filter { $0.parentID == parentID && $0.kind == .routineStep }.count
                    if model.change({ s in
                        if kind == .subhabit || kind == .routineStep { try s.changeOrdinaryParent(childID: childID, parentID: parentID, role: kind, from: day) }
                        else { try s.addRelationship(Relationship(parentID: parentID, childID: childID, kind: kind, from: day, order: order)) }
                    }) { dismiss() }
                }.disabled(childID == nil)
            }.plannerListSurface().navigationTitle("Related habit").toolbar { Button("Cancel") { dismiss() } }
        }.frame(minWidth: 320, minHeight: 350)
    }
}

extension RelationshipKind {
    var label: String {
        switch self { case .subhabit: "Ordinary subhabit"; case .routineStep: "Routine step"; case .prerequisite: "Prerequisite"; case .followUp: "Follow-up" }
    }
}
