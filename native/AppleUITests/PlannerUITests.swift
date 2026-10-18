import XCTest

final class PlannerUITests: XCTestCase {
    @MainActor func testCreateHabitAndRecordSuccess() throws {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
        app.buttons["Add"].tap(); app.buttons["New habit"].tap()
        let title = app.textFields["Habit title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5)); title.tap(); title.typeText("UI smoke habit")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["UI smoke habit"].waitForExistence(timeout: 5))
        app.staticTexts["UI smoke habit"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Success"].waitForExistence(timeout: 5)); app.buttons["Success"].tap()
        XCTAssertTrue(app.staticTexts["Success"].firstMatch.waitForExistence(timeout: 5))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Habit recorded"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testCreateTaskPersistsAcrossLaunch() throws {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
        app.buttons["Add"].tap(); app.buttons["New task"].tap()
        let title = app.textFields["Task title"]; XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap(); title.typeText("UI persistent task"); app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["UI persistent task"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["UI persistent task"].waitForExistence(timeout: 15))
    }
}
