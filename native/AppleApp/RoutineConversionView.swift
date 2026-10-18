import SwiftUI
import PlannerCore

struct RoutineConversionView: View {
    @EnvironmentObject private var model: PlannerModel
    let parentID: UUID
    let day: CalendarDay
    @State private var effectiveDate = Date()
    @State private var completed = false
    var body: some View {
        let date = CalendarDay(date: effectiveDate)
        let preview = model.snapshot.routineConversionPreview(parentID: parentID, from: date)
        Form {
            InlinePlannerError()
            DatePicker("Applies from", selection: $effectiveDate, displayedComponents: .date)
            Section("Preview") {
                Text("Direct organizational children become routine steps. Their schedules stay independent. Earlier links and observations remain in history.")
                ForEach(preview.eligibleChildren, id: \.self) { id in Text(model.snapshot.habits.first(where: { $0.id == id })?.configuration(on: date)?.name ?? "Child habit") }
                ForEach(preview.conflicts, id: \.self) { Text($0).foregroundStyle(.red) }
                if let safe = preview.earliestSafeDate, safe > date { Button("Use safe date: \(safe)") { effectiveDate = safe.date(timezone: .current) } }
            }
            Button("Convert to routine") { completed = model.change { try $0.convertToRoutine(parentID: parentID, from: date) } }.disabled(!preview.allowed || completed)
            if completed { Label("Routine converted", systemImage: "checkmark.circle") }
        }.navigationTitle("Routine conversion").onAppear { effectiveDate = day.date(timezone: .current) }
    }
}
