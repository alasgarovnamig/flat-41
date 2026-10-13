import AuthenticationServices
import SwiftUI
import EvTapCore

@MainActor
@Observable
final class BusinessViewModel {
    private(set) var subscription: Loadable<Subscription?> = .idle
    var period: BillingPeriod = .MONTH
    var planToBuy: PlanDef?
    var method: PaymentMethod = .CARD
    private(set) var working = false

    var catalog: Catalog { AppServices.shared.catalog.catalog }
    var current: Subscription? {
        guard case .loaded(let s?) = subscription, s.status != .EXPIRED else { return nil }
        return s
    }

    func load() async {
        await AppServices.shared.catalog.load()
        if subscription.value == nil { subscription = .loading }
        do {
            let s = try await AppServices.shared.api.send(API.subscription())
            subscription = .loaded(s)
        } catch {
            subscription = .failed(error)
        }
    }

    func setAutoRenew(_ on: Bool) async {
        working = true
        defer { working = false }
        do {
            let s = try await AppServices.shared.api.send(on ? API.resumeSubscription() : API.cancelSubscription())
            subscription = .loaded(s)
            AppServices.shared.bus.bump(.me, .subscription)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func subscribe() async -> CheckoutResponse? {
        guard let plan = planToBuy else { return nil }
        working = true
        defer { working = false }
        do {
            return try await AppServices.shared.api.send(API.checkout(.subscription(plan: plan.code, period: period, method: method, autoRenew: true,
                                                                                    returnUrl: PaymentCoordinator.returnURL)))
        } catch {
            AppServices.shared.toast.error(error)
            return nil
        }
    }
}

/// Business plans: current subscription (usage meter, auto-renew), monthly / yearly toggle, plan cards, checkout.
struct BusinessPlansView: View {
    @State private var vm = BusinessViewModel()
    @State private var confirmCancel = false
    @Environment(RefreshBus.self) private var bus
    @Environment(\.webAuthenticationSession) private var webAuth

    var body: some View {
        RequireAuth {
            ScrollView {
                VStack(alignment: .leading, spacing: EvSpace.s5) {
                    if let s = vm.current { currentCard(s) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("business.title")).evText(EvType.h2).foregroundStyle(EvColor.ink)
                        Text(L("business.subtitle")).font(.ev(EvType.body)).foregroundStyle(EvColor.muted)
                    }
                    Segmented(options: BillingPeriod.allCases, selection: $vm.period) {
                        $0 == .MONTH ? L("business.monthly") : "\(L("business.yearly")) · \(L("business.save2"))"
                    }
                    ForEach(vm.catalog.plans.filter(\.active)) { plan in planCard(plan) }
                }
                .padding(EvSize.gutter)
            }
            .refreshable { await vm.load() }
        }
        .evScreen(L("business.title"))
        .task(id: bus.version(.subscription)) { await vm.load() }
        .alert(L("business.cancelRenew"), isPresented: $confirmCancel) {
            Button(L("common.no"), role: .cancel) {}
            Button(L("common.yes"), role: .destructive) { Task { await vm.setAutoRenew(false) } }
        } message: {
            Text(L("business.cancelConfirm"))
        }
        .sheet(item: $vm.planToBuy) { plan in
            EvSheet(title: "\(plan.name.current) · \(Format.money(plan.price(for: vm.period)))") {
                PaymentMethodPicker(method: $vm.method, amount: plan.price(for: vm.period))
            } footer: {
                PrimaryButton(title: L("business.subscribe"), isLoading: vm.working) {
                    Task {
                        if let checkout = await vm.subscribe() {
                            vm.planToBuy = nil
                            // Let the sheet finish dismissing before the bank page is presented.
                            try? await Task.sleep(nanoseconds: 450_000_000)
                            await AppServices.shared.payments.complete(checkout, context: PaymentContext(), webAuth: webAuth)
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func currentCard(_ s: Subscription) -> some View {
        let planName = vm.catalog.plans.first { $0.code == s.planCode }?.name.current ?? s.planCode.rawValue
        let quota = s.usage.listingQuota
        return Card(title: "\(L("business.current")): \(planName)", trailing: {
            StatusPill(text: LE("subscriptionStatus", s.status.rawValue), tone: s.status == .ACTIVE ? .success : (s.status == .PAST_DUE ? .danger : .warning))
        }) {
            VStack(alignment: .leading, spacing: EvSpace.s3) {
                Text("\(s.period == .YEAR ? L("business.yearly") : L("business.monthly")) · \(s.autoRenew ? L("business.renewsOn", ["date": DateText.day(s.currentPeriodEnd)]) : L("business.endsOn", ["date": DateText.day(s.currentPeriodEnd)]))")
                    .font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.inkSecondary)
                if let mask = s.cardMask { Text(L("business.card", ["mask": mask])).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted) }
                SplitMeter(
                    left: .init(label: L("business.usage"), value: "\(s.usage.activeListings)", amount: Double(s.usage.activeListings)),
                    right: .init(label: L("business.quota"), value: quota == -1 ? "∞" : "\(quota)", amount: 0),
                    capacity: quota == -1 ? nil : Double(max(quota, s.usage.activeListings))
                )
                HStack(spacing: EvSpace.s2) {
                    creditTile(L("business.usageBumpsShort"), s.usage.bumpsLeft)
                    creditTile("VIP", s.usage.vipCreditsLeft)
                    creditTile("Premium", s.usage.premiumCreditsLeft)
                }
                if s.autoRenew {
                    PrimaryButton(title: L("business.cancelRenew"), kind: .secondary, isLoading: vm.working) { confirmCancel = true }
                } else {
                    PrimaryButton(title: L("business.resume"), isLoading: vm.working) { Task { await vm.setAutoRenew(true) } }
                }
            }
        }
    }

    private func creditTile(_ label: String, _ n: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(n)").evText(EvType.h2, weight: .regular).foregroundStyle(EvColor.ink)
            Text(label).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
        }
        .padding(EvSpace.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.surfaceRaised))
        .accessibilityElement(children: .combine)
    }

    private func planCard(_ p: PlanDef) -> some View {
        let isCurrent = vm.current?.planCode == p.code
        let highlight = p.code == .PRO
        return VStack(alignment: .leading, spacing: EvSpace.s3) {
            HStack {
                Text(p.name.current).evText(EvType.h2).foregroundStyle(highlight ? EvColor.onInk : EvColor.ink)
                Spacer()
                if highlight { Badge(text: L("business.popular"), kind: .vip) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Format.moneyParts(p.price(for: vm.period)).symbol)
                    .font(.ev(EvType.number, weight: .light, size: 24))
                    .foregroundStyle(highlight ? EvColor.subtle : EvColor.muted)
                Text(Format.moneyParts(p.price(for: vm.period)).value)
                    .evText(EvType.number)
                    .foregroundStyle(highlight ? EvColor.onInk : EvColor.ink)
                Text(vm.period == .YEAR ? L("business.perYear") : L("business.perMonth"))
                    .font(.ev(EvType.label, weight: .regular))
                    .foregroundStyle(highlight ? EvColor.subtle : EvColor.muted)
            }
            .accessibilityElement(children: .combine)
            VStack(alignment: .leading, spacing: 6) {
                feature(L("business.listings", ["n": p.listingQuota == -1 ? L("business.unlimited") : "\(p.listingQuota)"]), highlight)
                feature(L("business.bumps", ["n": p.monthlyBumps]), highlight)
                if p.monthlyVipCredits > 0 { feature(L("business.vipCredits", ["n": p.monthlyVipCredits]), highlight) }
                if p.monthlyPremiumCredits > 0 { feature(L("business.premiumCredits", ["n": p.monthlyPremiumCredits]), highlight) }
                feature(L("business.agents", ["n": p.maxAgents]), highlight)
                ForEach(p.features, id: \.self) { f in feature(L("business.features.\(f)"), highlight) }
            }
            PrimaryButton(title: isCurrent ? L("business.current") : L("business.subscribe"), kind: highlight ? .raised : .primary) {
                AppServices.shared.router.requireAuth { vm.planToBuy = p }
            }
            .disabled(isCurrent)
        }
        .padding(EvSpace.s5)
        .background(CardSurface(radius: EvRadius.xl, fill: highlight ? EvColor.ink : EvColor.surface))
    }

    private func feature(_ text: String, _ inverted: Bool) -> some View {
        HStack(alignment: .top, spacing: EvSpace.s2) {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(inverted ? EvColor.ink : EvColor.onInk)
                .frame(width: 20, height: 20)
                .background(Circle().fill(inverted ? EvColor.accent : EvColor.ink))
                .accessibilityHidden(true)
            Text(text).font(.ev(EvType.body)).foregroundStyle(inverted ? EvColor.onInk : EvColor.ink)
        }
    }
}
