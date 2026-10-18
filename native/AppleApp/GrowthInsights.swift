import SwiftUI
import Charts
import PlannerCore

struct GrowthView: View {
    @EnvironmentObject private var model: PlannerModel
    @State private var selectedID: UUID?
    @State private var cue = ""
    @State private var enjoyment = ""
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Return gently").font(.title2.weight(.semibold))
                    Text("Record attempts and the cues that help you return. These are descriptive records; no predictive model is active.").foregroundStyle(.secondary)
                }
                ForEach(model.snapshot.habits.filter { !$0.isArchived(on: .today) }) { habit in
                    Section(habit.configuration(on: .today)?.name ?? habit.configurations.last?.name ?? "Habit") {
                        let attempts = model.snapshot.attempts.filter { $0.habitID == habit.id }
                        if attempts.isEmpty { Text("No growth attempt recorded yet").foregroundStyle(.secondary) }
                        ForEach(Array(attempts.enumerated()), id: \.element.id) { index, attempt in
                            VStack(alignment: .leading) {
                                Text("Attempt \(index + 1) · \(attempt.start)").font(.headline)
                                if let end = attempt.endExclusive { Text("Closed from \(end)").font(.caption) }
                                if !attempt.cue.isEmpty { Text("Cue: \(attempt.cue)") }
                                if !attempt.enjoyment.isEmpty { Text("Enjoyment: \(attempt.enjoyment)") }
                                if let status = try? model.snapshot.growthStatus(attempt: attempt) {
                                    Text("\(status.state.rawValue.capitalized) · \(status.displayedRun) in this stretch").font(.headline)
                                    Text("Best \(status.bestRun) · Returns \(status.returns) · Total recorded closures \(status.totalClosed)").font(.caption)
                                    let awards = GrowthRules.awards(status: status, from: attempt.start, through: .today)
                                    if !awards.isEmpty {
                                        Text(awards.map { "\($0.axis) \($0.milestone)" }.joined(separator: " · ")).font(.caption).foregroundStyle(Palette.sage)
                                    }
                                }
                            }
                        }
                        Button(attempts.isEmpty ? "Start an attempt" : "Start a new attempt") { selectedID = habit.id; cue = ""; enjoyment = "" }
                    }
                }
            }.navigationTitle("Growing")
                .sheet(isPresented: Binding(get: { selectedID != nil }, set: { if !$0 { selectedID = nil } })) {
                    NavigationStack {
                        Form {
                            TextField("What will remind you?", text: $cue, axis: .vertical)
                            TextField("What makes it enjoyable?", text: $enjoyment, axis: .vertical)
                            Button("Start today") {
                                guard let selectedID else { return }
                                if model.change({ try $0.restartGrowth(habitID: selectedID, on: .today, cue: cue, enjoyment: enjoyment) }) { self.selectedID = nil }
                            }
                        }.navigationTitle("A new start").toolbar { Button("Cancel") { selectedID = nil } }
                    }.frame(minWidth: 300, minHeight: 300)
                }
        }
    }
}

private struct DailyMetric: Identifiable {
    var day: CalendarDay
    var successes = 0
    var unsuccessful = 0
    var missing = 0
    var id: CalendarDay { day }
}
struct InsightsView: View {
    @EnvironmentObject private var model: PlannerModel
    private var metrics: [DailyMetric] {
        (-29...0).compactMap { offset in
            guard let day = try? CalendarDay.today.adding(days: offset) else { return nil }
            var row = DailyMetric(day: day)
            for habit in model.snapshot.habits {
                switch model.status(habit, day: day).outcome {
                case .success: row.successes += 1
                case .unsuccessful: row.unsuccessful += 1
                case .missing: row.missing += 1
                default: break
                }
            }
            return row
        }
    }
    var body: some View {
        NavigationStack {
            List {
                Section("Last 30 days") {
                    Chart(metrics) { metric in
                        BarMark(x: .value("Date", metric.day.date(), unit: .day), y: .value("Successes", metric.successes)).foregroundStyle(Palette.sage)
                    }.frame(height: 210).accessibilityLabel("Recorded successful habit days over the past thirty days")
                    LabeledContent("Successful scheduled entries", value: "\(metrics.reduce(0) { $0 + $1.successes })")
                    LabeledContent("Explicitly unsuccessful entries", value: "\(metrics.reduce(0) { $0 + $1.unsuccessful })")
                    LabeledContent("Without a report", value: "\(metrics.reduce(0) { $0 + $1.missing })")
                    Text("Flexible schedules show period outcomes on eligible days. These counts are descriptive, not independent trials or evidence of behaviour change.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Research status") {
                    Label("Prediction is not enabled", systemImage: "flask")
                    Text("External datasets have not been loaded into this app. A later study will evaluate recovery-history features against simple frequency and streak baselines.")
                }
            }.navigationTitle("Insights")
        }
    }
}
