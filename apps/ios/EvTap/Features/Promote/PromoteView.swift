import AuthenticationServices
import SwiftUI
import EvTapCore

@MainActor
@Observable
final class PromoteViewModel {
    static let groupOrder: [PromotionType] = [.PREMIUM, .VIP, .BUMP, .AUTO_BUMP, .HIGHLIGHT, .URGENT]

    let listingId: String
    private(set) var listing: ListingDetail?
    /// One service per promotion type, or a bundle (mutually exclusive).
    var picked: [PromotionType: String] = [:]
    var bundleCode: String?
    var method: PaymentMethod = .WALLET
    private(set) var paying = false
    private(set) var applyingCredit: CreditKind?

    init(listingId: String) { self.listingId = listingId }

    var catalog: Catalog { AppServices.shared.catalog.catalog }
    var services: [ServiceDef] { catalog.services.filter(\.active) }

    struct ServiceGroup: Identifiable {
        let type: PromotionType
        let items: [ServiceDef]
        var id: String { type.rawValue }
    }

    var groups: [ServiceGroup] {
        var out: [ServiceGroup] = []
        for type in Self.groupOrder {
            let items = services.filter { $0.promotionType == type }.sorted { $0.sortOrder < $1.sortOrder }
            if !items.isEmpty { out.append(ServiceGroup(type: type, items: items)) }
        }
        return out
    }

    var verification: ServiceDef? { services.first { $0.code == "VERIFICATION" } }
    var selectedBundle: BundleDef? { catalog.bundles.first { $0.code == bundleCode } }
    var total: Int {
        if let b = selectedBundle { return b.price }
        return picked.values.reduce(0) { $0 + (catalog.service($1)?.price ?? 0) }
    }

    var credits: [CreditBalance] { AppServices.shared.session.me?.activeSubscription?.usage.availableCredits ?? [] }

    func load() async {
        await AppServices.shared.catalog.load()
        listing = try? await AppServices.shared.api.send(API.listing(listingId))
    }

    func toggle(_ s: ServiceDef) {
        guard let type = s.promotionType else { return }
        bundleCode = nil
        picked[type] = picked[type] == s.code ? nil : s.code
    }

    func toggleBundle(_ b: BundleDef) {
        picked = [:]
        bundleCode = bundleCode == b.code ? nil : b.code
    }

    func pay(verificationOnly: Bool = false) async -> CheckoutResponse? {
        paying = true
        defer { paying = false }
        let input: CheckoutInput
        if verificationOnly {
            input = .verification(listingId: listingId, method: method, returnUrl: PaymentCoordinator.returnURL)
        } else if let b = selectedBundle {
            input = .promotion(listingId: listingId, serviceCodes: nil, bundleCode: b.code, method: method, returnUrl: PaymentCoordinator.returnURL)
        } else {
            input = .promotion(listingId: listingId, serviceCodes: Array(picked.values).sorted(), bundleCode: nil, method: method, returnUrl: PaymentCoordinator.returnURL)
        }
        do {
            return try await AppServices.shared.api.send(API.checkout(input))
        } catch {
            AppServices.shared.toast.error(error)
            return nil
        }
    }

    func applyCredit(_ kind: CreditKind) async {
        applyingCredit = kind
        defer { applyingCredit = nil }
        do {
            _ = try await AppServices.shared.api.send(API.applyCredit(listingId, kind))
            AppServices.shared.toast.show(L("promote.creditApplied"), kind: .success)
            AppServices.shared.bus.bump(.me, .myListings, .listing)
            await load()
        } catch {
            AppServices.shared.toast.error(error)
        }
    }
}

/// Promote a listing: subscription credits, bundles, services by type, verification; wallet / card checkout.
struct PromoteView: View {
    let upsell: Bool
    @State private var vm: PromoteViewModel
    @Environment(\.webAuthenticationSession) private var webAuth

    init(listingId: String, upsell: Bool) {
        self.upsell = upsell
        _vm = State(initialValue: PromoteViewModel(listingId: listingId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                if upsell {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("post.upsellTitle")).evText(EvType.h3).foregroundStyle(EvColor.ink)
                        Text(L("post.upsellText")).font(.ev(EvType.body)).foregroundStyle(EvColor.inkSecondary)
                    }
                    .evCard(fill: EvColor.highlightBg)
                }
                if let l = vm.listing {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(l.title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(2)
                        ForEach(l.promotions) { p in
                            Label("\(vm.catalog.service(p.serviceCode)?.name.current ?? p.type.rawValue)\(p.endsAt.map { " · " + L("promote.active", ["date": DateText.day($0)]) } ?? "")",
                                  systemImage: "checkmark.circle")
                                .font(.ev(EvType.caption))
                                .foregroundStyle(EvColor.success)
                        }
                    }
                }
                if !vm.credits.isEmpty {
                    Card(title: L("promote.credits")) {
                        VStack(spacing: EvSpace.s3) {
                            ForEach(vm.credits) { c in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(LE("credit", c.kind.rawValue)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                                        Text(L("promote.creditsLeft", ["n": c.count])).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                                    }
                                    Spacer()
                                    PrimaryButton(title: L("promote.useCredit"), kind: .secondary, size: .small, fullWidth: false,
                                                  isLoading: vm.applyingCredit == c.kind) { Task { await vm.applyCredit(c.kind) } }
                                }
                            }
                        }
                    }
                }
                if !vm.catalog.bundles.isEmpty {
                    SectionHeader(title: L("promote.bundles"))
                    ForEach(vm.catalog.bundles) { b in bundleRow(b) }
                }
                SectionHeader(title: L("promote.services"))
                ForEach(vm.groups) { g in
                    VStack(spacing: EvSpace.s2) {
                        ForEach(g.items) { s in serviceRow(s, type: g.type) }
                    }
                }
                PaymentMethodPicker(method: $vm.method, amount: vm.total)
                if let v = vm.verification, vm.listing?.isVerified == false {
                    Card(title: L("promote.verificationTitle"), trailing: {
                        MoneyText(minor: v.price, style: EvType.bodyStrong)
                    }) {
                        VStack(alignment: .leading, spacing: EvSpace.s3) {
                            Text(v.description.current).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                            PrimaryButton(title: "\(L("promote.pay")) \(Format.money(v.price))", icon: "checkmark.seal", kind: .secondary, isLoading: vm.paying) {
                                Task { await pay(verificationOnly: true) }
                            }
                        }
                    }
                }
            }
            .padding(EvSize.gutter)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("promote.total")).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    MoneyText(minor: vm.total, style: EvType.h2)
                }
                Spacer()
                PrimaryButton(title: vm.total > 0 ? L("promote.pay") : L("promote.select"), icon: "arrow.up.right", fullWidth: false, isLoading: vm.paying) {
                    Task { await pay() }
                }
                .disabled(vm.total == 0)
            }
            .padding(.horizontal, EvSize.gutter)
            .padding(.vertical, EvSpace.s3)
            .evGlass(in: Rectangle())
        }
        .evScreen(L("promote.title"))
        .task { await vm.load() }
    }

    private func pay(verificationOnly: Bool = false) async {
        guard let checkout = await vm.pay(verificationOnly: verificationOnly) else { return }
        await AppServices.shared.payments.complete(checkout, context: PaymentContext(listingId: vm.listingId), webAuth: webAuth)
    }

    private func bundleRow(_ b: BundleDef) -> some View {
        let selected = vm.bundleCode == b.code
        let listPrice = vm.catalog.listPrice(of: b)
        return Button {
            vm.toggleBundle(b)
        } label: {
            HStack(alignment: .top, spacing: EvSpace.s3) {
                Image(systemName: "shippingbox")
                    .font(.system(size: 17))
                    .foregroundStyle(selected ? EvColor.onInk : EvColor.ink)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(selected ? EvColor.ink : EvColor.accent))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(b.name.current).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                    Text(b.serviceCodes.map { vm.catalog.service($0)?.name.current ?? $0 }.joined(separator: " + "))
                        .font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    if listPrice > b.price {
                        Badge(text: L("promote.economy", ["amount": Format.money(listPrice - b.price)]), kind: .tone(.success))
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Format.money(b.price)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                    if listPrice > b.price {
                        Text(Format.money(listPrice)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).strikethrough()
                    }
                }
            }
            .padding(EvSpace.s4)
            .background(CardSurface(radius: EvRadius.lg, fill: selected ? EvColor.surfaceRaised : EvColor.surface))
            .overlay(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).strokeBorder(EvColor.ink, lineWidth: selected ? 1.5 : 0))
        }
        .buttonStyle(EvPressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func serviceRow(_ s: ServiceDef, type: PromotionType) -> some View {
        let selected = vm.picked[type] == s.code
        return Button {
            vm.toggle(s)
        } label: {
            HStack(spacing: EvSpace.s3) {
                Image(systemName: type.icon)
                    .font(.system(size: 16))
                    .foregroundStyle(selected ? EvColor.onInk : EvColor.ink)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(selected ? EvColor.ink : EvColor.surfaceSunken))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.name.current).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                    Text(s.description.current).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).lineLimit(2)
                }
                Spacer()
                Text(Format.money(s.price)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                Image(systemName: selected ? "checkmark.square.fill" : "square")
                    .foregroundStyle(selected ? EvColor.ink : EvColor.subtle)
                    .accessibilityHidden(true)
            }
            .padding(EvSpace.s3)
            .background(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).fill(EvColor.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).strokeBorder(selected ? EvColor.ink : EvColor.hairline, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(EvPressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

extension PromotionType {
    var icon: String {
        switch self {
        case .PREMIUM: return "diamond"
        case .VIP: return "star"
        case .BUMP: return "arrow.up.circle"
        case .AUTO_BUMP: return "arrow.triangle.2.circlepath"
        case .HIGHLIGHT: return "paintpalette"
        case .URGENT: return "bolt"
        }
    }
}
