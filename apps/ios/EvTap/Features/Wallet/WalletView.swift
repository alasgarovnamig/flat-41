import AuthenticationServices
import SwiftUI
import EvTapCore

@MainActor
@Observable
final class WalletViewModel {
    static let quick = [1000, 2000, 5000, 10000, 30000]

    private(set) var wallet: Wallet?
    let transactions = PagedList<WalletTransaction> { page in
        try await AppServices.shared.api.send(API.walletTransactions(page: page))
    }
    var amountText = "50"
    private(set) var toppingUp = false

    var settings: CatalogSettings { AppServices.shared.catalog.settings }
    /// Minor units.
    var amount: Int { Int(((Double(amountText.replacingOccurrences(of: ",", with: ".")) ?? 0) * 100).rounded()) }
    var bonus: Int { Pricing.topupBonus(amount: amount, tiers: settings.topupBonuses) }
    var isValid: Bool { Validation.topup(amount: amount, settings: settings) }

    /// Recent activity for the barcode spark (absolute amounts, oldest → newest).
    var spark: [Double] { transactions.items.prefix(24).reversed().map { Double(abs($0.amount)) } }

    func load() async {
        let api = AppServices.shared.api
        async let w = Self.fetchWallet(api)
        await transactions.refresh()
        let fetched = await w
        if let fetched { wallet = fetched }
    }

    private nonisolated static func fetchWallet(_ api: APIClient) async -> Wallet? {
        try? await api.send(API.wallet())
    }

    func topup() async -> CheckoutResponse? {
        guard isValid else { return nil }
        toppingUp = true
        defer { toppingUp = false }
        do {
            return try await AppServices.shared.api.send(API.checkout(.walletTopup(amount: amount, returnUrl: PaymentCoordinator.returnURL)))
        } catch {
            AppServices.shared.toast.error(error)
            return nil
        }
    }
}

/// Wallet: balance as a big quiet number + barcode of recent activity, bonus balance, top-up card with bonus tiers,
/// transactions.
struct WalletView: View {
    @State private var vm = WalletViewModel()
    @Environment(RefreshBus.self) private var bus
    @Environment(\.webAuthenticationSession) private var webAuth
    @FocusState private var amountFocused: Bool

    var body: some View {
        RequireAuth {
            ScrollView {
                VStack(alignment: .leading, spacing: EvSpace.s4) {
                    balanceCards
                    topupCard
                    SectionHeader(title: L("wallet.transactions"))
                    transactionsList
                }
                .padding(EvSize.gutter)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await vm.load() }
        }
        .evScreen(L("wallet.title"))
        .task(id: bus.version(.wallet)) { await vm.load() }
    }

    private var balanceCards: some View {
        VStack(spacing: EvSpace.s3) {
            StatCard(label: L("wallet.balance"), money: Format.moneyParts(vm.wallet?.balance ?? 0, vm.wallet?.currency ?? .AZN),
                     caption: L("wallet.thisMonthActivity"), spark: vm.spark)
                .redacted(reason: vm.wallet == nil ? .placeholder : [])
            HStack {
                Text(L("wallet.bonus")).font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.muted)
                Spacer()
                MoneyText(minor: vm.wallet?.bonusBalance ?? 0, currency: vm.wallet?.currency ?? .AZN, style: EvType.h3)
            }
            .evCard(padding: EvSpace.s4, radius: EvRadius.lg, fill: EvColor.vipBg)
        }
    }

    private var topupCard: some View {
        Card(title: L("wallet.topup")) {
            VStack(alignment: .leading, spacing: EvSpace.s3) {
                FlowLayout {
                    ForEach(WalletViewModel.quick, id: \.self) { q in
                        SelectChip(title: Format.money(q), isSelected: vm.amount == q) { vm.amountText = String(q / 100) }
                    }
                }
                EvTextField(label: L("wallet.amount"), text: $vm.amountText.numeric(decimal: true),
                            hint: L("wallet.limits", ["min": Format.money(vm.settings.minTopup), "max": Format.money(vm.settings.maxTopup)]),
                            keyboard: .decimalPad)
                if vm.bonus > 0 {
                    Badge(text: L("wallet.bonusInfo", ["bonus": Format.money(vm.bonus)]), kind: .vip, large: true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(text: L("wallet.tiersTitle"))
                    let active = Pricing.topupTier(amount: vm.amount, tiers: vm.settings.topupBonuses)
                    ForEach(vm.settings.topupBonuses.sorted { $0.minAmount < $1.minAmount }, id: \.minAmount) { tier in
                        HStack(spacing: 6) {
                            Image(systemName: active == tier ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 12))
                                .foregroundStyle(active == tier ? EvColor.ink : EvColor.subtle)
                                .accessibilityHidden(true)
                            Text(L("wallet.tier", ["min": Format.money(tier.minAmount), "pct": Format.number(tier.bonusPercent)]))
                                .font(.ev(EvType.caption, weight: active == tier ? .semibold : .regular))
                                .foregroundStyle(active == tier ? EvColor.ink : EvColor.muted)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(active == tier ? .isSelected : [])
                    }
                    Text(L("wallet.bonusFirst")).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                }
                PrimaryButton(title: "\(L("wallet.topup")) · \(Format.money(vm.amount))", icon: "creditcard", isLoading: vm.toppingUp) {
                    Task {
                        if let checkout = await vm.topup() {
                            await AppServices.shared.payments.complete(checkout, context: PaymentContext(), webAuth: webAuth)
                        }
                    }
                }
                .disabled(!vm.isValid)
            }
        }
    }

    @ViewBuilder private var transactionsList: some View {
        let list = vm.transactions
        if list.isInitialLoading {
            ListSkeleton(rows: 4)
        } else if list.isEmpty {
            EmptyState(icon: "arrow.left.arrow.right", title: L("wallet.empty"))
        } else {
            RowGroup {
                ForEach(list.items) { tx in
                    HStack(spacing: EvSpace.s3) {
                        Image(systemName: tx.amount >= 0 ? "arrow.down.left" : "arrow.up.right")
                            .font(.system(size: 14))
                            .foregroundStyle(tx.amount >= 0 ? EvColor.success : EvColor.ink)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(tx.amount >= 0 ? EvColor.successBg : EvColor.surfaceSunken))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(LE("walletTx", tx.type.rawValue)).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                            Text(tx.description).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).lineLimit(1)
                            Text(DateText.dateTime(tx.createdAt)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                        }
                        Spacer()
                        Text("\(tx.amount > 0 ? "+" : "")\(Format.money(tx.amount))")
                            .font(.ev(EvType.bodyStrong))
                            .foregroundStyle(tx.amount > 0 ? EvColor.success : EvColor.ink)
                    }
                    .padding(.horizontal, EvSpace.s4)
                    .padding(.vertical, EvSpace.s3)
                    .accessibilityElement(children: .combine)
                    .onAppear { Task { await list.loadMoreIfNeeded(tx) } }
                    if tx.id != list.items.last?.id { RowDivider() }
                }
            }
        }
    }
}
