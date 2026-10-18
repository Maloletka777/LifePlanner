// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LivePlanner",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PlannerCore", targets: ["PlannerCore"]),
               .library(name: "PlannerStorage", targets: ["PlannerStorage"])],
    targets: [
        .target(name: "PlannerCore"),
        .target(name: "CSQLite", path: "Vendor/SQLite", exclude: ["PROVENANCE.json"], publicHeadersPath: "include",
                cSettings: [.define("SQLITE_OMIT_LOAD_EXTENSION"), .define("SQLITE_THREADSAFE", to: "1")]),
        .target(name: "PlannerStorage", dependencies: ["PlannerCore", "CSQLite"]),
        .testTarget(name: "PlannerCoreTests", dependencies: ["PlannerCore"]),
        .testTarget(name: "PlannerStorageTests", dependencies: ["PlannerCore", "PlannerStorage"])
    ]
)
