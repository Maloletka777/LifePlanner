import XCTest

final class PlannerUITests: XCTestCase {
    @MainActor func testTimedTaskRemainsReachableOnRestoredTimeline() {
        let app = XCUIApplication(); home(app)
        app.buttons["Add"].tap(); app.buttons["New task"].tap()
        let title = app.textFields["Task title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5)); title.tap(); title.typeText("UI timeline task\n")
        let timed = app.switches["Planned time"]; reveal(timed, in: app)
        if timed.value as? String != "1" {
            let control = timed.switches.firstMatch
            if control.exists { control.tap() } else { timed.tap() }
        }
        XCTAssertEqual(timed.value as? String, "1")
        app.buttons["Save"].tap()
        let item = app.descendants(matching: .any).matching(identifier: "UI timeline task").firstMatch
        reveal(item, in: app)
        let timeline = XCTAttachment(screenshot: app.screenshot())
        timeline.name = "Restored timed task"; timeline.lifetime = .keepAlways; add(timeline)
        home(app); reveal(item, in: app)
        XCTAssertTrue(item.isHittable)
        app.terminate(); app.launchArguments = ["-ui-test-dark"]; app.launch()
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
        let dark = XCTAttachment(screenshot: app.screenshot())
        dark.name = "Restored calendar dark"; dark.lifetime = .keepAlways; add(dark)
    }
    @MainActor func testRestoredNavigationKeepsPlannerToolsReachable() {
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["Today"].exists)
        XCTAssertTrue(app.tabBars.buttons["Overview"].exists)
        XCTAssertTrue(app.tabBars.buttons["More"].exists)
        let calendar = XCTAttachment(screenshot: app.screenshot())
        calendar.name = "Restored calendar"; calendar.lifetime = .keepAlways; add(calendar)
        app.tabBars.buttons["Overview"].tap()
        XCTAssertTrue(app.navigationBars["Overview"].waitForExistence(timeout: 5))
        app.tabBars.buttons["More"].tap()
        app.buttons["Habits & routines"].tap()
        XCTAssertTrue(app.buttons["Add habit"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Growing"].tap()
        XCTAssertTrue(app.navigationBars["Growing"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Settings & backups"].tap()
        XCTAssertTrue(app.buttons["Export backup"].waitForExistence(timeout: 5))
    }
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
        // A plain native NavigationLink with one Text is exposed as a Button,
        // while a richer label also exposes child StaticText. Check the title
        // independently of that presentation detail before and after relaunch.
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "UI persistent task").firstMatch.waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "UI persistent task").firstMatch.waitForExistence(timeout: 15))
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
        let task = app.descendants(matching: .any).matching(identifier: "UI focus conversion").firstMatch; reveal(task, in: app)
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
        let title = app.textFields["Habit title"]; XCTAssertTrue(title.waitForExistence(timeout: 5)); title.tap(); title.typeText("UI checklist habit\n")
        let closure = app.switches["Complete when all checklist items are checked"]; reveal(closure, in: app)
        if closure.value as? String != "1" {
            // SwiftUI exposes both a labelled row and its actual UISwitch.
            // Tap the inner control rather than the text row or its rounded edge.
            let control = closure.switches.firstMatch
            if control.exists { control.tap() } else { closure.tap() }
        }
        XCTAssertTrue(closure.waitForExistence(timeout: 5))
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
