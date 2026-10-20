import SwiftUI
import PlannerCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum Palette {
    // LifePlanner 0.5.9 build 40: src/ui/theme/color-themes.ts.
    static let background = adaptive(0xEBEDEF, 0x000000)
    static let surface = adaptive(0xFFFFFF, 0x1C1E21)
    static let header = adaptive(0xEBEDEF, 0x000000)
    static let hero = adaptive(0xF2F2F2, 0x292B2E)
    static let ink = adaptive(0x13161A, 0xF0F2F4)
    static let muted = adaptive(0x646A70, 0xA4A8AD)
    static let sage = adaptive(0x1E2226, 0xF0F2F4) // Existing callers: structural accent, now graphite.
    static let onAccent = adaptive(0xFFFFFF, 0x000000)
    static let line = adaptive(0xDEE0E2, 0x181818)
    static let done = adaptive(0x1D7D3E, 0x6BD586)
    static let overdue = adaptive(0xAA3832, 0xF27D72)
    static let high = adaptive(0xA77F17, 0xEBB425)
    static func accent(_ key: String) -> Color {
        switch key {
        case "blue": adaptive(0x4A7ACB, 0x87AFF1)
        case "orange": adaptive(0xB76041, 0xDB947A)
        case "purple": adaptive(0x9462B7, 0xC49BE0)
        case "pink": adaptive(0x48878E, 0x80B9C0)
        default: adaptive(0x488D62, 0x80BE96)
        }
    }
    private static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        #if os(iOS)
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
        #else
        Color(nsColor: NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
        #endif
    }
}

extension View {
    func plannerListSurface() -> some View {
        scrollContentBackground(.hidden).background(Palette.background)
    }
    @ViewBuilder func plannerGlass() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            glassEffect(.regular.tint(Palette.sage.opacity(0.12)).interactive(), in: Circle())
        } else {
            background(.regularMaterial, in: Circle())
        }
    }
}

struct MoreView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Your planner") {
                    NavigationLink { HabitsView() } label: { Label("Habits & routines", systemImage: "leaf") }
                    NavigationLink { GrowthView() } label: { Label("Growing", systemImage: "chart.line.uptrend.xyaxis") }
                    NavigationLink { FocusHistoryView(day: .today) } label: { Label("Daily Focus cards & history", systemImage: "square.and.pencil") }
                }
                Section("Preferences & data") {
                    NavigationLink { SettingsView() } label: { Label("Settings & backups", systemImage: "gearshape") }
                }
            }
            .plannerListSurface()
            .navigationTitle("More")
        }
    }
}
