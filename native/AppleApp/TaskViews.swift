import SwiftUI
import PlannerCore

struct TaskEditor: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let day: CalendarDay
    var taskID: UUID? = nil
    var initialBlock: DayBlock = .anytime
    @State private var task = PlannerTask(title: "", day: .today)
    @State private var date = Date()
    @State private var planned = Date()
    @State private var timed = false
    @State private var duration = 30
    @State private var durationEnabled = false
    @State private var checklistText = ""
    var body: some View {
        NavigationStack {
            Form {
                TextField("Task title", text: $task.title)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Notes", text: $task.note, axis: .vertical)
                Picker("Part of day", selection: $task.block) { ForEach(DayBlock.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) } }
                Toggle("Planned time", isOn: $timed)
                if timed { DatePicker("Time", selection: $planned, displayedComponents: .hourAndMinute) }
                Toggle("Planned duration", isOn: $durationEnabled)
                if durationEnabled { Stepper("\(duration) minutes", value: $duration, in: 1...1440) }
                if taskID == nil { TextField("Checklist — one item per line", text: $checklistText, axis: .vertical) }
            }.plannerListSurface().navigationTitle(taskID == nil ? "New task" : "Edit task")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") {
                        var result = task; result.day = CalendarDay(date: date)
                        result.plannedMinute = timed ? minuteOfDay(planned) : nil; result.durationMinutes = durationEnabled ? duration : nil
                        if taskID == nil { result.checklist = checklistText.split(separator: "\n").map { TaskCheck(text: String($0)) } }
                        if model.change({ s in
                            if let taskID, let i = s.tasks.firstIndex(where: { $0.id == taskID }) { s.tasks[i] = result }
                            else { s.tasks.append(result) }
                        }) { dismiss() }
                    }.disabled(task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }.onAppear {
                    date = day.date(timezone: .current)
                    if taskID == nil { task.block = initialBlock }
                    if let taskID, let existing = model.snapshot.tasks.first(where: { $0.id == taskID }) {
                        task = existing; date = task.day.date(timezone: .current)
                        timed = task.plannedMinute != nil; planned = timeDate(task.plannedMinute ?? 540)
                        durationEnabled = task.durationMinutes != nil; duration = task.durationMinutes ?? 30
                    }
                }
        }.frame(minWidth: 320, minHeight: 400)
    }
}

struct TaskDetail: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let taskID: UUID
    @State private var editing = false
    @State private var deleting = false
    @State private var newItem = ""
    var body: some View {
        if let task = model.snapshot.tasks.first(where: { $0.id == taskID }) {
            Form {
                Section {
                    Text(task.title).font(.title2)
                    Text(task.day.description)
                    if !task.note.isEmpty { Text(task.note) }
                    Toggle("Completed", isOn: Binding(get: { task.done }, set: { value in
                        model.change { s in if let i = s.tasks.firstIndex(where: { $0.id == taskID }) { s.tasks[i].done = value } }
                    })).disabled(task.day > .today)
                }
                Section("Checklist") {
                    ForEach(task.checklist) { item in
                        Toggle(item.text, isOn: Binding(get: { item.done }, set: { value in
                            model.change { s in
                                if let i = s.tasks.firstIndex(where: { $0.id == taskID }), let j = s.tasks[i].checklist.firstIndex(where: { $0.id == item.id }) { s.tasks[i].checklist[j].done = value }
                            }
                        })).disabled(task.day > .today)
                    }
                    TextField("New item", text: $newItem)
                    Button("Add checklist item") {
                        if model.change({ s in if let i = s.tasks.firstIndex(where: { $0.id == taskID }) { s.tasks[i].checklist.append(TaskCheck(text: newItem)) } }) { newItem = "" }
                    }.disabled(newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Section {
                    Button(task.archived ? "Restore task" : "Archive task") {
                        model.change { s in if let i = s.tasks.firstIndex(where: { $0.id == taskID }) { s.tasks[i].archived.toggle() } }
                    }
                    Button("Permanently delete", role: .destructive) { deleting = true }
                }
            }.plannerListSurface().navigationTitle("Task").toolbar { Button("Edit") { editing = true } }
                .sheet(isPresented: $editing) { TaskEditor(day: task.day, taskID: taskID) }
                .confirmationDialog("Delete this task permanently?", isPresented: $deleting, titleVisibility: .visible) {
                    Button("Delete", role: .destructive) { if model.change({ $0.tasks.removeAll { $0.id == taskID } }) { dismiss() } }
                }
        }
    }
}
