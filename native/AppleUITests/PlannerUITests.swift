import XCTest

final class PlannerUITests: XCTestCase {
    @MainActor private func reveal(_ element: XCUIElement, in app: XCUIApplication, upwards: Bool = true) {
        for _ in 0..<10 {
            if element.exists && element.isHittable { return }
            if upwards { app.swipeUp() } else { app.swipeDown() }
        }
        XCTAssertTrue(element.exists && element.isHittable)
    }
    @MainActor private func home(_ app: XCUIApplication) {
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
    }
    @MainActor private func createHabit(_ title: String, in app: XCUIApplication) {
        home(app)
        app.buttons["Add"].tap(); app.buttons["New habit"].tap()
        let field = app.textFields["Habit title"]; XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText(title); app.buttons["Save"].tap()
        let created = app.staticTexts[title].firstMatch; reveal(created, in: app)
    }
    @MainActor func testCreateHabitAndRecordSuccess() throws {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
        app.buttons["Add"].tap(); app.buttons["New habit"].tap()
        let title = app.textFields["Habit title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5)); title.tap(); title.typeText("UI smoke habit")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["UI smoke habit"].waitForExistence(timeout: 5))
        app.staticTexts["UI smoke habit"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Success"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["habit.outcome"].label, "State, Missing")
        app.buttons["Success"].tap()
        XCTAssertEqual(app.staticTexts["habit.outcome"].label, "State, Success")
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["UI smoke habit"].waitForExistence(timeout: 15))
        app.staticTexts["UI smoke habit"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["habit.outcome"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["habit.outcome"].label, "State, Success")
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
    @MainActor func testDailyFocusConvertsToPersistedTask() throws {
        let app = XCUIApplication(); home(app)
        let history = app.buttons["Daily Focus cards & history"]; reveal(history, in: app); history.tap()
        let newFocus = app.buttons["New focus"]
        XCTAssertTrue(newFocus.waitForExistence(timeout: 5)); XCTAssertTrue(newFocus.isHittable); newFocus.tap()
        let title = app.textFields["Focus title"]; XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap(); title.typeText("UI focus conversion"); app.buttons["Save focus"].tap()
        let card = app.staticTexts["UI focus conversion"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5)); card.tap()
        let convert = app.buttons["Convert to task"]; reveal(convert, in: app); convert.tap()
        home(app)
        app.buttons["Next day"].tap()
        let task = app.staticTexts["UI focus conversion"].firstMatch; reveal(task, in: app)
        XCTAssertTrue(task.exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Focus converted to next-day task"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testRoutineParentIsDerivedFromItsStep() throws {
        let app = XCUIApplication()
        createHabit("UI routine parent", in: app); createHabit("UI routine leaf", in: app)
        home(app)
        let parent = app.staticTexts["UI routine parent"].firstMatch; reveal(parent, in: app); parent.tap()
        let link = app.buttons["Link a habit"]; reveal(link, in: app); link.tap()
        app.buttons["relationship.kind"].tap(); app.buttons["Routine step"].tap()
        app.buttons["relationship.child"].tap(); app.buttons["UI routine leaf"].tap()
        app.buttons["Link"].tap()
        XCTAssertFalse(app.buttons["Success"].exists)
        home(app)
        let leaf = app.staticTexts["UI routine leaf"].firstMatch; reveal(leaf, in: app); leaf.tap()
        XCTAssertTrue(app.buttons["Success"].waitForExistence(timeout: 5)); app.buttons["Success"].tap()
        home(app); reveal(parent, in: app); parent.tap()
        XCTAssertTrue(app.staticTexts["habit.outcome"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["habit.outcome"].label,"State, Success")
    }
    @MainActor func testChecklistOwnsCompletionAndReopening() throws {
        let app = XCUIApplication(); home(app)
        app.buttons["Add"].tap(); app.buttons["New habit"].tap()
        let title = app.textFields["Habit title"]; XCTAssertTrue(title.waitForExistence(timeout: 5)); title.tap(); title.typeText("UI checklist habit")
        let closure = app.switches["Complete when all checklist items are checked"]; reveal(closure, in: app)
        if closure.value as? String != "1" {
            closure.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
        XCTAssertEqual(closure.value as? String, "1")
        let line = app.textFields["Checklist — one item per line"]; reveal(line, in: app); line.tap(); line.typeText("UI checklist step")
        app.buttons["Save"].tap()
        let habit = app.staticTexts["UI checklist habit"].firstMatch; reveal(habit, in: app); habit.tap()
        XCTAssertFalse(app.buttons["Success"].exists)
        let tick = app.buttons["UI checklist step"]; reveal(tick, in: app); tick.tap()
        reveal(app.staticTexts["habit.outcome"], in: app, upwards: false)
        XCTAssertEqual(app.staticTexts["habit.outcome"].label,"State, Success")
        reveal(tick, in: app); tick.tap()
        reveal(app.staticTexts["habit.outcome"], in: app, upwards: false)
        XCTAssertEqual(app.staticTexts["habit.outcome"].label,"State, Missing")
    }
}
