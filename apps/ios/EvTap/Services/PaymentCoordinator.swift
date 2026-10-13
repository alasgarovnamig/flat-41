import AuthenticationServices
import SwiftUI
import EvTapCore

/// Card payments via the bank's hosted page (docs/MOCKBANK.md):
///   POST /checkout { returnUrl: evtap://payment/result } → paymentUrl
///   → ASWebAuthenticationSession (callback scheme `evtap`)
///   → bank → API /payments/return/mockbank → 302 evtap://payment/result?paymentId=..&status=..
///   → the session resolves with that URL → Payment result screen polls GET /payments/:id until final.
/// Wallet payments are final immediately and go straight to the result screen.
@MainActor
final class PaymentCoordinator {
    /// `returnUrl` sent to /checkout, /bookings, /bookings/:id/pay.
    static let returnURL = DeepLink.paymentReturnURL

    func complete(_ checkout: CheckoutResponse, context: PaymentContext, webAuth: WebAuthenticationSession) async {
        var paymentId = checkout.paymentId
        var status: String? = checkout.status.rawValue
        if checkout.needsBrowser, let s = checkout.paymentUrl, let url = URL(string: s) {
            do {
                let callback = try await webAuth.authenticate(using: url, callbackURLScheme: DeepLink.scheme, preferredBrowserSession: .ephemeral)
                if case .paymentResult(let id, let st)? = DeepLink.parse(callback) {
                    paymentId = id
                    status = st
                }
            } catch {
                // Dismissed / cancelled: the result screen still polls — the payment may have completed in the browser.
                status = nil
            }
        }
        AppServices.shared.router.push(.paymentResult(paymentId: paymentId, status: status, context: context))
    }
}
