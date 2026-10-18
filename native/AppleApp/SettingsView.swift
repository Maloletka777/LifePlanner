import SwiftUI
import PlannerCore

struct SettingsView: View {
    @EnvironmentObject private var model: PlannerModel
    @State private var exporting = false
    @State private var importing = false
    @State private var backup = BackupDocument(data: Data())
    @State private var pendingImport: Data?
    @State private var confirmRestore = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Progress") {
                    Toggle("Weight habits by importance", isOn: Binding(get: { model.snapshot.weightedProgress }, set: { value in model.change { $0.weightedProgress = value } }))
                    Text("Importance weights: low 1, normal 2, high 3, critical 4. Tasks contribute a weight of 1. Skipped, blocked and future items are excluded.").font(.caption)
                }
                Section("Reminders") {
                    Text(model.reminderStatus)
                    Button("Allow notifications") { Task { await model.enableNotifications() } }
                    Button("Refresh reminders") { model.refreshReminders() }
                    Text("Schedules the earliest 60 reminders within the next 30 days. Open the app periodically to refresh. Delivery depends on system permission and device settings.").font(.caption)
                }
                Section("Your data") {
                    Button("Export backup", systemImage: "square.and.arrow.up") {
                        do { backup = BackupDocument(data: try model.snapshot.encoded()); exporting = true }
                        catch { model.error = error.localizedDescription }
                    }
                    Button("Restore native backup", systemImage: "square.and.arrow.down") { importing = true }
                    Button("Reload from disk") { model.reload() }
                    Text("Native JSON backups only. Restore validates the file and saves a safety copy of your current data first. The Expo database is a different format and is not automatically imported.").font(.caption)
                    LabeledContent("Database revision", value: "\(model.snapshot.revision)")
                    NavigationLink("Archived tasks") {
                        List(model.snapshot.tasks.filter(\.archived)) { task in NavigationLink(task.title) { TaskDetail(taskID: task.id) } }.navigationTitle("Archived tasks")
                    }
                }
                Section("About") {
                    Text("Live Planner · Swift migration")
                    Text("Local storage. No account, backend or telemetry. Native rewrite prepared with AI assistance. Apple Watch, HealthKit, cloud sync and prediction are future work.").font(.caption)
                }
            }.navigationTitle("Settings")
                .fileExporter(isPresented: $exporting, document: backup, contentType: .json, defaultFilename: "LivePlanner-\(CalendarDay.today).json") { result in
                    if case .failure(let error) = result { model.error = error.localizedDescription }
                }
                .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                    do {
                        let url = try result.get()
                        let granted = url.startAccessingSecurityScopedResource()
                        defer { if granted { url.stopAccessingSecurityScopedResource() } }
                        let data = try Data(contentsOf: url)
                        _ = try PlannerSnapshot.decode(data)
                        pendingImport = data; confirmRestore = true
                    } catch { model.error = error.localizedDescription }
                }
                .confirmationDialog("Replace planner data with this backup? A safety copy will be saved first.", isPresented: $confirmRestore, titleVisibility: .visible) {
                    Button("Restore backup", role: .destructive) { if let data = pendingImport { _ = model.restore(data) }; pendingImport = nil }
                    Button("Cancel", role: .cancel) { pendingImport = nil }
                }
        }
    }
}
