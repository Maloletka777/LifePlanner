import Foundation
import PlannerCore
import CSQLite

public struct StorageError: Error, LocalizedError {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}

/// One validated aggregate per transaction, stored in a separate native database.
/// Revision checks prevent two windows from silently overwriting each other's data.
/// This format deliberately does not pretend to be Expo's 15-migration schema.
public final class SQLitePlannerStore {
    private var database: OpaquePointer?
    public let url: URL
    public init(url: URL) throws {
        self.url = url
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let error = failure("Open database"); sqlite3_close(database); database = nil; throw error
        }
        do {
            sqlite3_busy_timeout(database, 5000)
            try execute("PRAGMA journal_mode=WAL")
            try execute("PRAGMA synchronous=FULL")
            let version = try userVersion()
            guard version == 0 || version == 1 else { throw StorageError("Unsupported native database version \(version). The database was preserved.") }
            if version == 0 {
                // Never write into an unrelated existing SQLite database, including the Expo database.
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(database, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", -1, &statement, nil) == SQLITE_OK else { throw failure("Inspect database") }
                defer { sqlite3_finalize(statement) }
                guard sqlite3_step(statement) == SQLITE_ROW, sqlite3_column_int(statement, 0) == 0 else { throw StorageError("Existing database is not a native LivePlanner store. Select a new path.") }
                try execute("BEGIN IMMEDIATE")
                do {
                    try execute("CREATE TABLE planner_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload BLOB NOT NULL)")
                    try execute("PRAGMA user_version=1"); try execute("COMMIT")
                } catch { try? execute("ROLLBACK"); throw error }
            }
            _ = try load()
        } catch {
            sqlite3_close(database); database = nil; throw error
        }
    }
    deinit { sqlite3_close(database) }
    public static func applicationURL() throws -> URL {
        let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return folder.appendingPathComponent("LivePlannerNative", isDirectory: true).appendingPathComponent("liveplanner-native.sqlite")
    }
    private func failure(_ operation: String) -> StorageError {
        StorageError("\(operation): \(database.map { String(cString: sqlite3_errmsg($0)) } ?? "database unavailable")")
    }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw failure("SQLite operation") }
    }
    private func userVersion() throws -> Int32 {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "PRAGMA user_version", -1, &statement, nil) == SQLITE_OK else { throw failure("Read schema version") }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw failure("Read schema version") }
        return sqlite3_column_int(statement, 0)
    }
    public func load() throws -> PlannerSnapshot {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT revision,payload FROM planner_state WHERE id=1", -1, &statement, nil) == SQLITE_OK else { throw failure("Load planner") }
        defer { sqlite3_finalize(statement) }
        let step = sqlite3_step(statement)
        if step == SQLITE_DONE { return PlannerSnapshot() }
        guard step == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 1) else { throw failure("Read planner state") }
        let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 1)))
        let snapshot = try PlannerSnapshot.decode(data)
        guard snapshot.revision == sqlite3_column_int64(statement, 0) else { throw StorageError("Database revision mismatch; data was preserved") }
        return snapshot
    }
    @discardableResult public func save(_ snapshot: PlannerSnapshot) throws -> PlannerSnapshot {
        try snapshot.validate()
        guard snapshot.revision < Int64.max else { throw StorageError("Revision overflow") }
        try execute("BEGIN IMMEDIATE")
        do {
            let current = try load()
            guard current.revision == snapshot.revision else { throw PlannerError.conflict("Another window changed the planner. Reload before saving.") }
            var next = snapshot; next.revision += 1
            let data = try next.encoded()
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "INSERT INTO planner_state(id,revision,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload", -1, &statement, nil) == SQLITE_OK else { throw failure("Prepare save") }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_bind_int64(statement, 1, next.revision) == SQLITE_OK else { throw failure("Bind revision") }
            let result = data.withUnsafeBytes { buffer -> Int32 in
                let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
                return sqlite3_bind_blob(statement, 2, buffer.baseAddress, Int32(buffer.count), transient)
            }
            guard result == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw failure("Save planner") }
            try execute("COMMIT"); return next
        } catch { try? execute("ROLLBACK"); throw error }
    }
    public func exportBackup(to url: URL) throws { try load().encoded().write(to: url, options: .atomic) }
    @discardableResult public func restoreBackup(_ data: Data, safetyBackupURL: URL) throws -> PlannerSnapshot {
        var incoming = try PlannerSnapshot.decode(data)
        let current = try load()
        // The caller chooses a fresh destination. Never overwrite an earlier safety backup.
        guard !FileManager.default.fileExists(atPath: safetyBackupURL.path) else { throw StorageError("Safety backup already exists") }
        try current.encoded().write(to: safetyBackupURL, options: .withoutOverwriting)
        incoming.revision = current.revision
        return try save(incoming)
    }
}
