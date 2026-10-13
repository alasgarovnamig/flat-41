import SwiftUI
import EvTapCore

@MainActor
@Observable
final class PaymentResultViewModel {
    static let pollInterval: UInt64 = 2_000_000_000
    static let maxWait: TimeInterval = 90

    let paymentId: String
    private(set) var payment: Payment?
    private(set) var timedOut = false
    private(set) var error: Error?
    @ObservationIgnored private var subscription: UUID?
    @ObservationIgnored private var finished = false

    init(paymentId: String) { self.paymentId = paymentId }

    var isFinal: Bool { payment?.status.isFinal == true }

    /// Polls `GET /payments/:id` every 2 s until the status is final (max 90 s); realtime `payment:updated` short-circuits.
    func poll() async {
        let services = AppServices.shared
        subscription = services.realtime.subscribe { [weak self] event in
            guard let self, case .paymentUpdated(let p) = event, p.id == self.paymentId else { return }
            self.update(p)
        }
        let started = Date()
        while !Task.isCancelled && !isFinal {
            do {
                update(try await services.api.send(API.payment(paymentId)))
                error = nil
            } catch {
                if payment == nil { self.error = error }
            }
            if isFinal { break }
            if Date().timeIntervalSince(started) > Self.maxWait {
                timedOut = true
                break
            }
            try? await Task.sleep(nanoseconds: Self.pollInterval)
        }
    }

    func stop() {
        if let subscription { AppServices.shared.realtime.unsubscribe(subscription) }
    }

    private func update(_ p: Payment) {
        payment = p
        if p.status.isFinal && !finished {
            finished = true
            AppServices.shared.bus.paymentFinished()
        }
    }
}

/// `evtap://payment/result?paymentId=..&status=..` target. The status hint is never trusted — GET /payments/:id is.
struct PaymentResultView: View {
    let statusHint: String?
    let context: PaymentContext
    @State private var vm: PaymentResultViewModel
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(paymentId: String, statusHint: String?, context: PaymentContext) {
        self.statusHint = statusHint
        self.context = context
        _vm = State(initialValue: PaymentResultViewModel(paymentId: paymentId))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: EvSpace.s6) {
                statusHeader
                if let p = vm.payment {
                    Card {
                        VStack(spacing: EvSpace.s2) {
                            HStack {
                                Text(L("payment.amount")).font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.muted)
                                Spacer()
                            }
                            HStack {
                                MoneyText(minor: p.amount, currency: p.currency)
                                Spacer()
                            }
                            KeyValueRow(key: LE("paymentPurpose", p.purpose.rawValue), value: LE("paymentMethod", p.method.rawValue) + (p.cardMask.map { " · \($0)" } ?? ""))
                            if !p.description.isEmpty {
                                Text(p.description).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                } else if let e = vm.error {
                    ErrorStateView(error: e)
                }
                actions
            }
            .padding(EvSize.gutter)
            .padding(.top, EvSpace.s8)
        }
        .appBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.poll() }
        .onDisappear { vm.stop() }
    }

    private var status: PaymentStatus? { vm.isFinal ? vm.payment?.status : nil }

    private var statusHeader: some View {
        VStack(spacing: EvSpace.s3) {
            ZStack {
                Circle().fill(iconBackground).frame(width: 96, height: 96)
                if status == nil && !vm.timedOut {
                    ProgressView().controlSize(.large).tint(EvColor.ink)
                } else {
                    Image(systemName: icon).font(.system(size: 38, weight: .light)).foregroundStyle(iconColor)
                }
            }
            .accessibilityHidden(true)
            Text(title)
                .evText(EvType.h2)
                .foregroundStyle(EvColor.ink)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.updatesFrequently)
            if status == .FAILED, let reason = vm.payment?.failureReason {
                Text(reason).font(.ev(EvType.body)).foregroundStyle(EvColor.muted).multilineTextAlignment(.center)
            }
        }
        .animation(EvMotion.curve(reduceMotion: reduceMotion), value: status)
    }

    private var title: String {
        switch status {
        case .SUCCEEDED?: return L("payment.success")
        case .FAILED?: return L("payment.failed")
        case .CANCELLED?: return L("payment.cancelled")
        case .REFUNDED?, .PARTIALLY_REFUNDED?: return L("payment.refunded")
        default: return vm.timedOut ? L("payment.pendingLong") : L("payment.processing")
        }
    }

    private var icon: String {
        switch status {
        case .SUCCEEDED?: return "checkmark"
        case .FAILED?: return "xmark"
        case .CANCELLED?: return "minus"
        case .REFUNDED?, .PARTIALLY_REFUNDED?: return "arrow.uturn.backward"
        default: return "clock"
        }
    }

    private var iconColor: Color {
        switch status {
        case .SUCCEEDED?: return EvColor.success
        case .FAILED?: return EvColor.danger
        default: return EvColor.ink
        }
    }

    private var iconBackground: Color {
        switch status {
        case .SUCCEEDED?: return EvColor.successBg
        case .FAILED?: return EvColor.dangerBg
        case .REFUNDED?, .PARTIALLY_REFUNDED?: return EvColor.warningBg
        default: return EvColor.surfaceSunken
        }
    }

    @ViewBuilder private var actions: some View {
        VStack(spacing: EvSpace.s2) {
            if let p = vm.payment, vm.isFinal, let next = nextStep(p) {
                PrimaryButton(title: next.title) { router.replaceTop(with: next.route) }
            }
            if status == .FAILED || status == .CANCELLED {
                PrimaryButton(title: L("payment.tryAgain"), kind: .secondary) { router.pop() }
            }
            PrimaryButton(title: L("payment.backHome"), kind: .ghost) {
                router.popToRoot()
                router.select(.home)
            }
        }
    }

    private struct NextStep {
        let title: String
        let route: Route
    }

    private func nextStep(_ p: Payment) -> NextStep? {
        let listingId = p.listingId ?? context.listingId
        let bookingId = p.bookingId ?? context.bookingId
        switch p.purpose {
        case .BOOKING:
            guard let bookingId else { return nil }
            return NextStep(title: L("payment.toBooking"), route: .booking(id: bookingId))
        case .WALLET_TOPUP:
            return NextStep(title: L("payment.toWallet"), route: .wallet)
        case .SUBSCRIPTION:
            return NextStep(title: L("payment.toBusiness"), route: .business)
        case .LISTING_FEE:
            return NextStep(title: L("payment.toMyListings"), route: .myListings)
        case .PROMOTION, .VERIFICATION:
            guard let listingId else { return nil }
            return NextStep(title: L("payment.toListing"), route: .listing(id: listingId))
        }
    }
}
