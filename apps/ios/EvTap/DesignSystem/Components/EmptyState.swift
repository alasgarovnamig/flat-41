import SwiftUI
import EvTapCore

/// Thin-line icon in a 72pt circle, title (h3), muted body, black pill CTA.
struct EmptyState: View {
    let icon: String
    let title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: EvSpace.s3) {
            Image(systemName: icon)
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(EvColor.ink)
                .frame(width: 72, height: 72)
                .background(Circle().fill(EvColor.surfaceSunken))
                .accessibilityHidden(true)
            Text(title)
                .evText(EvType.h3)
                .foregroundStyle(EvColor.ink)
                .multilineTextAlignment(.center)
            if let message {
                Text(message)
                    .font(.ev(EvType.body))
                    .foregroundStyle(EvColor.muted)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                PrimaryButton(title: actionTitle, size: .small, fullWidth: false, action: action)
                    .padding(.top, EvSpace.s2)
            }
        }
        .padding(EvSpace.s8)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

/// Error variant of `EmptyState` with a retry button.
struct ErrorStateView: View {
    let error: Error
    var retry: (() -> Void)?

    var body: some View {
        EmptyState(
            icon: (error as? APIError)?.isNetwork == true ? "wifi.slash" : "exclamationmark.triangle",
            title: L("common.errorTitle"),
            message: L(error: error),
            actionTitle: retry == nil ? nil : L("common.retry"),
            action: retry
        )
    }
}

/// Centered spinner on the canvas.
struct LoadingView: View {
    var body: some View {
        ProgressView()
            .controlSize(.large)
            .tint(EvColor.ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel(L("common.loading"))
    }
}
