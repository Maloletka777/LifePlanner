import SwiftUI
import PlannerCore
import PlannerStorage
import UniformTypeIdentifiers
import UserNotifications

@main
struct LivePlannerApp: App {
    @StateObject private var model = PlannerModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .tint(Palette.sage)
                .onChange(of: phase) { _, phase in if phase == .active { model.reload() } }
        }
    }
}

enum Palette {
    static let sage = Color(red: 0.27, green: 0.43, blue: 0.35)
    static func accent(_ key: String) -> Color {
        switch key { case "blue": .blue; case "orange": .orange; case "purple": .purple; case "pink": .pink; default: sage }
    }
}

@MainActor
final class PlannerModel: ObservableObject {
    @Published private(set) var snapshot = PlannerSnapshot()
    @Published var error: String?
    @Published private(set) var ready = false
    @Published var reminderStatus = "Not requested"
    private var store: SQLitePlannerStore?
    private var reminderTask: Task<Void, Never>?
    init() { reload() }
    func reload() {
        do {
            if store == nil { store = try SQLitePlannerStore(url: SQLitePlannerStore.applicationURL()) }
            snapshot = try store!.load(); ready = true
            refreshReminders()
        } catch { ready = false; self.error = error.localizedDescription }
    }
    @discardableResult func change(_ operation: (inout PlannerSnapshot) throws -> Void) -> Bool {
        guard let store, ready else { error = "Storage is unavailable. Your existing data has been preserved."; return false }
        do {
            var next = snapshot; try operation(&next)
            snapshot = try store.save(next); refreshReminders(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func status(_ habit: Habit, day: CalendarDay) -> HabitStatus {
        (try? snapshot.status(habitID: habit.id, on: day)) ?? HabitStatus(.notScheduled)
    }
    func enableNotifications() async {
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            reminderStatus = allowed ? "Enabled" : "Permission denied — enable in system settings"
            refreshReminders()
        } catch { self.error = error.localizedDescription }
    }
    func refreshReminders() {
        reminderTask?.cancel()
        let snapshot = snapshot
        reminderTask = Task { @MainActor in
            do {
                let center = UNUserNotificationCenter.current()
                let authorization = await notificationAuthorization()
                guard !Task.isCancelled else { return }
                guard authorization == UNAuthorizationStatus.authorized.rawValue || authorization == UNAuthorizationStatus.provisional.rawValue else {
                    reminderStatus = authorization == UNAuthorizationStatus.denied.rawValue ? "Permission denied" : "Not requested"; return
                }
                let plan = try snapshot.reminderPlan()
                let pending = await pendingNotificationIDs()
                guard !Task.isCancelled else { return }
                // Only remove this app's planner requests. Never clear other notification families.
                let wanted = Set(plan.map(\.id))
                let stale = pending.filter { $0.hasPrefix("liveplanner.") && !wanted.contains($0) }
                center.removePendingNotificationRequests(withIdentifiers: stale)
                for reminder in plan {
                    guard !Task.isCancelled else { return }
                    let content = UNMutableNotificationContent()
                    content.title = reminder.title; content.body = "A moment for your plan."; content.sound = .default
                    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                    var components = calendar.dateComponents([.year,.month,.day,.hour,.minute,.second], from: reminder.fireAt)
                    components.timeZone = calendar.timeZone
                    let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
                    try await center.add(UNNotificationRequest(identifier: reminder.id, content: content, trigger: trigger))
                }
                reminderStatus = "\(plan.count) reminders scheduled; refreshed when the app opens"
            } catch { self.error = "Reminders: \(error.localizedDescription)" }
        }
    }
    func restore(_ data: Data) -> Bool {
        guard let store else { return false }
        do {
            let safety = store.url.deletingLastPathComponent().appendingPathComponent("before-restore-\(UUID()).json")
            snapshot = try store.restoreBackup(data, safetyBackupURL: safety); refreshReminders(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
}

// Transfer only value types across Swift concurrency boundaries. Apple's older SDK
// notification objects themselves are not Sendable.
private func notificationAuthorization() async -> Int {
    await withCheckedContinuation { continuation in
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            continuation.resume(returning: settings.authorizationStatus.rawValue)
        }
    }
}
private func pendingNotificationIDs() async -> [String] {
    await withCheckedContinuation { continuation in
        UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
            continuation.resume(returning: requests.map(\.identifier))
        }
    }
}

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct RootView: View {
    @EnvironmentObject private var model: PlannerModel
    var body: some View {
        Group {
            if model.ready {
                TabView {
                    TodayView().tabItem { Label("Today", systemImage: "sun.max") }
                    HabitsView().tabItem { Label("Habits", systemImage: "leaf") }
                    GrowthView().tabItem { Label("Growing", systemImage: "chart.line.uptrend.xyaxis") }
                    InsightsView().tabItem { Label("Insights", systemImage: "chart.bar") }
                    SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }
                }
            } else {
                ContentUnavailableView {
                    Label("Planner could not open", systemImage: "externaldrive.badge.exclamationmark")
                } description: { Text("Your data has been preserved. Resolve the storage error and retry.") }
                actions: { Button("Retry") { model.reload() } }
            }
        }
        .alert("Live Planner", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}
