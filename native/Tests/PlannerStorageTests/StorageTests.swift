import XCTest
import PlannerCore
@testable import PlannerStorage

final class StorageTests: XCTestCase {
    func temporaryURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("native.sqlite") }
    func testSaveReopenAndRevision() throws {
        let url = temporaryURL()
        var saved: PlannerSnapshot
        do {
            let store = try SQLitePlannerStore(url: url)
            var state = try store.load(); XCTAssertEqual(state.revision, 0)
            _ = try state.createHabit(HabitConfiguration(name: "Test", from: .today))
            saved = try store.save(state); XCTAssertEqual(saved.revision, 1)
        }
        let reopened = try SQLitePlannerStore(url: url)
        XCTAssertEqual(try reopened.load().habits[0].id, saved.habits[0].id)
        XCTAssertEqual(try reopened.load().revision, 1)
    }
    func testStaleSaveRejectedAcrossConnections() throws {
        let url = temporaryURL(); let a = try SQLitePlannerStore(url: url); let b = try SQLitePlannerStore(url: url)
        let stale = try b.load(); _ = try a.save(a.load())
        XCTAssertThrowsError(try b.save(stale)); XCTAssertEqual(try a.load().revision, 1)
    }
    func testInvalidMutationNeverReachesDisk() throws {
        let store = try SQLitePlannerStore(url: temporaryURL())
        var state = try store.load(); state.tasks.append(PlannerTask(title: "", day: .today))
        XCTAssertThrowsError(try store.save(state)); XCTAssertTrue(try store.load().tasks.isEmpty)
    }
    func testRestoreCreatesSafetyCopyAndRebasesRevision() throws {
        let store = try SQLitePlannerStore(url: temporaryURL())
        var state = try store.load(); state.tasks.append(PlannerTask(title: "Keep me", day: .today)); _ = try store.save(state)
        let backupURL = store.url.deletingLastPathComponent().appendingPathComponent("safety.json")
        let restored = try store.restoreBackup(PlannerSnapshot().encoded(), safetyBackupURL: backupURL)
        XCTAssertEqual(restored.revision, 2); XCTAssertTrue(restored.tasks.isEmpty)
        let safety = try PlannerSnapshot.decode(Data(contentsOf: backupURL)); XCTAssertEqual(safety.tasks[0].title, "Keep me")
        XCTAssertThrowsError(try store.restoreBackup(PlannerSnapshot().encoded(), safetyBackupURL: backupURL))
    }
    func testCorruptImportPreservesCurrentState() throws {
        let store = try SQLitePlannerStore(url: temporaryURL())
        _ = try store.save(store.load())
        let before = try store.load()
        XCTAssertThrowsError(try store.restoreBackup(Data("broken".utf8), safetyBackupURL: store.url.appendingPathExtension("json")))
        XCTAssertEqual(try store.load(), before)
    }
    func testGarbageDatabaseFailsWithoutReset() throws {
        let url = temporaryURL(); try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = Data("not a sqlite database".utf8); try data.write(to: url)
        XCTAssertThrowsError(try SQLitePlannerStore(url: url)); XCTAssertEqual(try Data(contentsOf: url), data)
    }
}
