import SwiftUI
import EvTapCore

/// Wallet vs card. Wallet shows the spendable balance and is disabled when it cannot cover `amount`.
struct PaymentMethodPicker: View {
    @Binding var method: PaymentMethod
    /// Minor units.
    let amount: Int
    var allowWallet = true

    @Environment(SessionStore.self) private var session

    private var balance: Int { session.me?.wallet.spendable ?? 0 }
    private var enough: Bool { balance >= amount }

    var body: some View {
        VStack(alignment: .leading, spacing: EvSpace.s2) {
            FieldLabel(text: L("payment.method"))
            if allowWallet {
                option(.WALLET, icon: "wallet.pass", title: L("payment.wallet"),
                       subtitle: enough ? L("payment.walletBalance", ["amount": Format.money(balance)]) : "\(L("payment.insufficient")) · \(Format.money(balance))",
                       disabled: !enough)
            }
            option(.CARD, icon: "creditcard", title: L("payment.card"), subtitle: "Visa · Mastercard", disabled: false)
        }
        .onAppear {
            if method == .WALLET && (!allowWallet || !enough) { method = .CARD }
        }
        .onChange(of: amount) { _, _ in
            if method == .WALLET && !enough { method = .CARD }
        }
    }

    private func option(_ m: PaymentMethod, icon: String, title: String, subtitle: String, disabled: Bool) -> some View {
        let selected = method == m
        return Button {
            method = m
        } label: {
            HStack(spacing: EvSpace.s3) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(selected ? EvColor.ink : EvColor.surfaceSunken))
                    .foregroundStyle(selected ? EvColor.onInk : EvColor.ink)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                    Text(subtitle)
                        .font(.ev(EvType.caption))
                        .foregroundStyle(disabled && m == .WALLET ? EvColor.danger : EvColor.muted)
                }
                Spacer()
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(selected ? EvColor.ink : EvColor.subtle)
                    .accessibilityHidden(true)
            }
            .padding(EvSpace.s3)
            .background(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).fill(EvColor.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).strokeBorder(selected ? EvColor.ink : EvColor.hairline, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(EvPressStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.55 : 1)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
