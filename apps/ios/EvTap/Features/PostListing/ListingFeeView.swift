import AuthenticationServices
import SwiftUI
import EvTapCore

/// Listing created as DRAFT (free quota exhausted) → pay LISTING_FEE via POST /checkout.
struct ListingFeeView: View {
    let listingId: String
    @State private var method: PaymentMethod = .CARD
    @State private var paying = false
    @Environment(SessionStore.self) private var session
    @Environment(CatalogStore.self) private var catalog
    @Environment(Router.self) private var router
    @Environment(\.webAuthenticationSession) private var webAuth

    private var fee: Int { session.me?.quota.listingFee ?? catalog.settings.listingFee }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                VStack(alignment: .leading, spacing: EvSpace.s3) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 22, weight: .light))
                        .frame(width: 52, height: 52)
                        .background(Circle().fill(EvColor.accent))
                        .accessibilityHidden(true)
                    MoneyText(minor: fee, style: EvType.display)
                    Text(L("post.feeText")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
                }
                .evCard()
                PaymentMethodPicker(method: $method, amount: fee)
                PrimaryButton(title: L("post.payFee", ["fee": Format.money(fee)]), isLoading: paying) { Task { await pay() } }
                PrimaryButton(title: L("post.later"), kind: .ghost) { router.replaceTop(with: .myListings) }
            }
            .padding(EvSize.gutter)
        }
        .evScreen(L("post.feeTitle"))
    }

    private func pay() async {
        paying = true
        defer { paying = false }
        do {
            let checkout = try await AppServices.shared.api.send(API.checkout(.listingFee(listingId: listingId, method: method, returnUrl: PaymentCoordinator.returnURL)))
            await AppServices.shared.payments.complete(checkout, context: PaymentContext(listingId: listingId), webAuth: webAuth)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}
