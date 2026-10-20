import SwiftUI
import PlannerCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum Palette {
    // Light values restored from the owner's original calendar screenshot.
    static let background = adaptive(0xEAD6B3, 0x1D211E)
    static let surface = adaptive(0xFAF2E7, 0x282E29)
    static let header = adaptive(0xF4E7D4, 0x222923)
    static let ink = adaptive(0x17213B, 0xF4EEE3)
    static let muted = adaptive(0x626977, 0xB6BCAF)
    static let sage = adaptive(0x365441, 0xAED0AD)
    static let onAccent = adaptive(0xFAF2E7, 0x17261D)
    static let line = adaptive(0xD1C3A9, 0x485248)
    static func accent(_ key: String) -> Color {
        switch key {
        case "blue": adaptive(0x466D88, 0xA4C5E0)
        case "orange": adaptive(0x99643C, 0xE3B78D)
        case "purple": adaptive(0x77638D, 0xCBB5DE)
        case "pink": adaptive(0xA35E76, 0xE6B1C2)
        default: sage
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
