import SwiftUI
import PlannerCore

struct FocusHistoryView: View {
    @EnvironmentObject private var model: PlannerModel
    let day: CalendarDay
    @State private var query = ""
    @State private var archived = true
    @State private var creating = false
    var body: some View {
        List {
            let visible = model.snapshot.focusEntries.filter { $0.isVisible(on: day) }
            if query.isEmpty && !visible.isEmpty {
                Section("For \(day)") { ForEach(visible) { focus in focusLink(focus) } }
            }
            Section("History") {
                Toggle("Include archived", isOn: $archived)
                ForEach(model.snapshot.searchFocus(query, includeArchived: archived)) { focus in focusLink(focus) }
            }
            if model.snapshot.focusEntries.isEmpty { Text("A new day starts empty. Your previous focus stays in history.").foregroundStyle(.secondary) }
        }.navigationTitle("Daily Focus").searchable(text: $query)
            .toolbar { Button("New focus", systemImage: "plus") { creating = true } }
            .sheet(isPresented: $creating) { FocusEditor(day: day) }
    }
    private func focusLink(_ focus: DailyFocus) -> some View {
        NavigationLink { FocusDetail(focusID: focus.id) } label: {
            VStack(alignment: .leading) {
                Text(focus.title)
                Text("\(focus.day)\(focus.archived ? " · Archived" : "")").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct FocusEditor: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let day: CalendarDay
    var focusID: UUID? = nil
    @State private var focus = DailyFocus(title: "", day: .today)
    @State private var checklist = ""
    var body: some View {
        NavigationStack {
            Form {
                InlinePlannerError()
                TextField("Focus title", text: $focus.title, axis: .vertical)
                TextField("Context & intentions", text: $focus.body, axis: .vertical)
                TextField("Checklist — one item per line", text: $checklist, axis: .vertical)
                Text("One active focus per date. Pinning makes the same card visible across a period.").font(.caption)
            }.navigationTitle(focusID == nil ? "New focus" : "Edit focus")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save focus") {
                        var updated = focus
                        var available = focus.checklist
                        updated.checklist = checklist.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { line in
                            if let i = available.firstIndex(where: { $0.text == line }) { return available.remove(at: i) }
                            return TaskCheck(text: line)
                        }
                        if model.change({ s in
                            try s.saveFocus(updated)
                            if focusID == nil, let i = s.journal.firstIndex(where: { $0.day == day && $0.focus == updated.title }) {
                                s.journal[i].focus = "" // The legacy field is now represented by the saved card; journal notes remain.
                            }
                        }) { dismiss() }
                    }.disabled(focus.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }.onAppear {
                    if let focusID, let stored = model.snapshot.focusEntries.first(where: { $0.id == focusID }) { focus = stored }
                    else {
                        focus = DailyFocus(title: model.snapshot.journal.first(where: { $0.day == day })?.focus ?? "", day: day)
                    }
                    checklist = focus.checklist.map(\.text).joined(separator: "\n")
                }
        }.frame(minWidth: 320, minHeight: 400)
    }
}

struct FocusDetail: View {
    @EnvironmentObject private var model: PlannerModel
    @Environment(\.dismiss) private var dismiss
    let focusID: UUID
    @State private var editing = false
    @State private var targetDate = Date()
    @State private var pinStart = Date()
    @State private var pinEnd = Date()
    var body: some View {
        if let focus = model.snapshot.focusEntries.first(where: { $0.id == focusID }) {
            Form {
                InlinePlannerError()
                Section {
                    Text(focus.title).font(.title2)
                    if !focus.body.isEmpty { Text(focus.body) }
                    Text(focus.day.description)
                    if focus.sourceID != nil { Text(focus.provenance == .extended ? "Continued from an earlier focus" : "Copied from an earlier focus").font(.caption) }
                    if let pinned = focus.pinned { Text("Pinned: \(pinned.start) → \(pinned.endExclusive?.description ?? "open") (end excluded)").font(.caption) }
                }
                Section("Checklist") {
                    ForEach(focus.checklist) { item in
                        Toggle(item.text, isOn: Binding(get: { item.done }, set: { done in
                            model.change { s in
                                guard let i = s.focusEntries.firstIndex(where: { $0.id == focusID }),
                                      let j = s.focusEntries[i].checklist.firstIndex(where: { $0.id == item.id }) else { return }
                                s.focusEntries[i].checklist[j].done = done
                            }
                        })).disabled(focus.archived || focus.day > .today)
                    }
                }
                Section("Continue your focus") {
                    DatePicker("Target date", selection: $targetDate, displayedComponents: .date)
                    Button("Copy forward") { model.change { _ = try $0.copyFocus(focusID, to: CalendarDay(date: targetDate)) } }
                    Button("Extend to date") { model.change { _ = try $0.copyFocus(focusID, to: CalendarDay(date: targetDate), extending: true) } }
                    Text("Copy starts a fresh checklist. Extend keeps checked lines and links to the earlier focus; the original is retained.").font(.caption)
                    Button("Convert to task") {
                        if model.change({ _ = try $0.convertFocusToTask(focusID, on: CalendarDay(date: targetDate)) }) { dismiss() }
                    }.disabled(focus.convertedTaskID != nil)
                }
                Section("Pin across dates") {
                    DatePicker("From", selection: $pinStart, displayedComponents: .date)
                    DatePicker("Through", selection: $pinEnd, displayedComponents: .date)
                    Button("Pin focus") { model.change { try $0.pinFocus(focusID, from: CalendarDay(date: pinStart), through: CalendarDay(date: pinEnd)) } }
                    if focus.pinned != nil {
                        Button("Unpin") { model.change { s in if let i = s.focusEntries.firstIndex(where: { $0.id == focusID }) { s.focusEntries[i].pinned = nil } } }
                    }
                }
                Section {
                    Button(focus.archived ? "Restore focus" : "Archive focus") {
                        model.change { s in if let i = s.focusEntries.firstIndex(where: { $0.id == focusID }) { s.focusEntries[i].archived.toggle() } }
                    }
                }
            }.navigationTitle("Daily Focus").toolbar { Button("Edit") { editing = true } }
                .sheet(isPresented: $editing) { FocusEditor(day: focus.day, focusID: focusID) }
                .onAppear {
                    targetDate = (try? focus.day.adding(days: 1))?.date(timezone: .current) ?? Date()
                    pinStart = focus.day.date(timezone: .current); pinEnd = pinStart
                }
        }
    }
}

struct InlinePlannerError: View {
    @EnvironmentObject private var model: PlannerModel
    var body: some View {
        if let message = model.error {
            VStack(alignment: .leading) {
                Text(message).foregroundStyle(.red).accessibilityIdentifier("planner.error")
                Button("Dismiss message") { model.error = nil }
            }
        }
    }
}
