import SwiftUI

/// Soft grey canvas with a faint lighter "frame" glow at the top (reference: big rounded app frame on canvas).
struct AppBackground: View {
    var body: some View {
        ZStack {
            EvColor.canvas
            RadialGradient(colors: [EvColor.frame, EvColor.canvas.opacity(0)], center: .top, startRadius: 0, endRadius: 520)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

extension View {
    /// Places the screen on the app canvas.
    func appBackground() -> some View {
        background(AppBackground())
    }
}
