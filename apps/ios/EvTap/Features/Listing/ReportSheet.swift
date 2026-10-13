import SwiftUI
import EvTapCore

/// Report a listing: reason chips + optional comment → POST /listings/:id/report.
struct ReportSheet: View {
    let onSend: (ReportReason, String) async -> Bool

    @State private var reason: ReportReason? = nil
    @State private var comment = ""
    @State private var sending = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EvSheet(title: L("report.title")) {
            FieldLabel(text: L("report.reason"))
            FlowLayout {
                ForEach(ReportReason.allCases) { r in
                    SelectChip(title: LE("reportReason", r.rawValue), isSelected: reason == r) { reason = r }
                }
            }
            EvTextField(label: L("report.comment"), text: $comment, multiline: true, maxLength: 1000)
        } footer: {
            PrimaryButton(title: L("common.send"), isLoading: sending) {
                guard let reason else { return }
                Task {
                    sending = true
                    let ok = await onSend(reason, comment)
                    sending = false
                    if ok { dismiss() }
                }
            }
            .disabled(reason == nil)
        }
        .presentationDetents([.medium, .large])
    }
}
