import AuthenticationServices
import SwiftUI
import EvTapCore

@MainActor
@Observable
final class BookingDetailViewModel {
    let bookingId: String
    private(set) var state: Loadable<Booking> = .idle
    private(set) var working = false

    init(bookingId: String) { self.bookingId = bookingId }

    func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await AppServices.shared.api.send(API.booking(bookingId)))
        } catch {
            if state.value == nil { state = .failed(error) }
        }
    }

    func cancel(reason: String) async -> Bool {
        working = true
        defer { working = false }
        do {
            let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
            state = .loaded(try await AppServices.shared.api.send(API.cancelBooking(bookingId, reason: r.isEmpty ? nil : String(r.prefix(500)))))
            AppServices.shared.toast.show(L("bookings.cancelled"), kind: .success)
            AppServices.shared.bus.bump(.bookings, .me)
            return true
        } catch {
            AppServices.shared.toast.error(error)
            return false
        }
    }

    func review(rating: Int, comment: String) async -> ValidationErrors? {
        let errors = Validation.review(rating: rating, comment: comment)
        guard errors.isEmpty else { return errors }
        working = true
        defer { working = false }
        do {
            _ = try await AppServices.shared.api.send(API.reviewBooking(bookingId, ReviewInput(rating: rating, comment: comment.trimmingCharacters(in: .whitespacesAndNewlines))))
            AppServices.shared.toast.show(L("bookings.reviewSent"), kind: .success)
            await load()
            return nil
        } catch {
            AppServices.shared.toast.error(error)
            return [:]
        }
    }

    /// Resume an unpaid booking (hold not expired yet) → `POST /bookings/:id/pay`.
    func pay(method: PaymentMethod) async -> CheckoutResponse? {
        working = true
        defer { working = false }
        do {
            return try await AppServices.shared.api.send(API.payBooking(bookingId, method: method, returnUrl: PaymentCoordinator.returnURL))
        } catch {
            AppServices.shared.toast.error(error)
            return nil
        }
    }
}

struct BookingDetailView: View {
    @State private var vm: BookingDetailViewModel
    @State private var showCancel = false
    @State private var showReview = false
    @State private var showPay = false
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(CatalogStore.self) private var catalog
    @Environment(RefreshBus.self) private var bus
    @Environment(\.openURL) private var openURL
    @Environment(\.webAuthenticationSession) private var webAuth

    init(bookingId: String) {
        _vm = State(initialValue: BookingDetailViewModel(bookingId: bookingId))
    }

    var body: some View {
        RequireAuth {
            Group {
                switch vm.state {
                case .loaded(let b): content(b)
                case .failed(let e): ErrorStateView(error: e) { Task { await vm.load() } }
                default: LoadingView()
                }
            }
        }
        .evScreen(L("bookings.detail"))
        .task(id: bus.version(.bookings)) { await vm.load() }
    }

    private func content(_ b: Booking) -> some View {
        let isHost = b.host.id == session.me?.id
        let other = isHost ? b.guest : b.host
        return ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s4) {
                Button {
                    router.push(.listing(id: b.listing.id))
                } label: {
                    HStack(spacing: EvSpace.s3) {
                        RemoteImage(url: AppServices.shared.api.mediaURL(b.listing.coverUrl))
                            .frame(width: 76, height: 76)
                            .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            StatusPill(text: LE("bookingStatus", b.status.rawValue), tone: b.status.tone)
                            Text(b.listing.title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(2)
                            if let a = b.listing.address { Text(a).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted) }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").foregroundStyle(EvColor.inkSecondary).accessibilityHidden(true)
                    }
                    .evCard(padding: EvSpace.s3, radius: EvRadius.lg)
                }
                .buttonStyle(EvPressStyle())

                Card {
                    VStack(spacing: 0) {
                        KeyValueRow(key: L("bookings.dates"), value: "\(DateText.isoDayShort(b.checkIn)) → \(DateText.isoDayShort(b.checkOut))")
                        KeyValueRow(key: L("booking.guests"), value: "\(b.guests)")
                        Rectangle().fill(EvColor.hairline).frame(height: 1).padding(.vertical, 6)
                        KeyValueRow(key: L("booking.nightsTimes", ["price": Format.price(b.nightlyPrice, b.currency), "n": b.nights]), value: Format.money(b.subtotal, b.currency))
                        if isHost {
                            KeyValueRow(key: L("bookings.hostFee"), value: "− \(Format.money(b.hostFee, b.currency))")
                            KeyValueRow(key: L("bookings.hostPayout"), value: Format.money(b.hostPayout, b.currency), bold: true)
                            KeyValueRow(key: L("bookings.payout"), value: LE("payoutStatus", b.payoutStatus.rawValue))
                        } else {
                            KeyValueRow(key: L("booking.serviceFee"), value: Format.money(b.guestFee, b.currency))
                            KeyValueRow(key: L("booking.total"), value: Format.money(b.total, b.currency), bold: true)
                        }
                        if b.refundedAmount > 0 {
                            KeyValueRow(key: L("bookings.refunded"), value: Format.money(b.refundedAmount, b.currency), valueColor: EvColor.success)
                        }
                        if let by = b.cancelledBy {
                            NoticeBanner(text: L("bookings.cancelledBy", ["who": LE("cancelledBy", by.rawValue)]) + (b.cancelReason.map { " — \($0)" } ?? ""),
                                         tone: .danger, icon: "xmark.circle")
                                .padding(.top, EvSpace.s2)
                        }
                    }
                }

                Card(title: isHost ? L("bookings.guest") : L("bookings.host")) {
                    HStack(spacing: EvSpace.s3) {
                        Avatar(url: AppServices.shared.api.mediaURL(other.avatarUrl), name: other.name, size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(other.name).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                            if let p = other.phone { Text(Format.phone(p)).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted) }
                        }
                        Spacer()
                        if let p = other.phone, let url = URL(string: "tel:\(p)") {
                            IconButton(systemName: "phone", label: L("listing.call"), style: .ink) { openURL(url) }
                        }
                    }
                }

                if !isHost && b.status == .PENDING_PAYMENT {
                    PrimaryButton(title: L("bookings.payNow"), icon: "creditcard") { showPay = true }
                }
                if b.canReview && !isHost {
                    PrimaryButton(title: L("bookings.writeReview"), icon: "star", kind: .secondary) { showReview = true }
                }
                if b.isCancellable {
                    if !isHost {
                        Text(L("booking.policyText", ["h": catalog.settings.freeCancellationHours]))
                            .font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    }
                    PrimaryButton(title: L("bookings.cancel"), icon: "xmark.circle", kind: .destructive) { showCancel = true }
                }
            }
            .padding(EvSize.gutter)
        }
        .refreshable { await vm.load() }
        .sheet(isPresented: $showCancel) {
            CancelBookingSheet { reason in await vm.cancel(reason: reason) }
        }
        .sheet(isPresented: $showReview) {
            ReviewSheet { rating, comment in await vm.review(rating: rating, comment: comment) }
        }
        .sheet(isPresented: $showPay) {
            PayBookingSheet(amount: b.total, currency: b.currency, working: vm.working) { method in
                if let checkout = await vm.pay(method: method) {
                    showPay = false
                    try? await Task.sleep(nanoseconds: 450_000_000) // sheet dismissal before the bank page
                    await AppServices.shared.payments.complete(checkout, context: PaymentContext(listingId: b.listing.id, bookingId: b.id), webAuth: webAuth)
                }
            }
        }
    }
}

private struct CancelBookingSheet: View {
    let onCancel: (String) async -> Bool
    @State private var reason = ""
    @State private var confirm = false
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EvSheet(title: L("bookings.cancel")) {
            Text(L("bookings.cancelConfirm")).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
            EvTextField(label: L("bookings.cancelReason"), text: $reason, multiline: true, maxLength: 500)
        } footer: {
            PrimaryButton(title: L("bookings.cancel"), kind: .destructive, isLoading: working) { confirm = true }
        }
        .presentationDetents([.medium])
        .alert(L("common.confirm"), isPresented: $confirm) {
            Button(L("common.no"), role: .cancel) {}
            Button(L("common.yes"), role: .destructive) {
                Task {
                    working = true
                    let ok = await onCancel(reason)
                    working = false
                    if ok { dismiss() }
                }
            }
        } message: {
            Text(L("bookings.cancelConfirm"))
        }
    }
}

private struct ReviewSheet: View {
    let onSend: (Int, String) async -> ValidationErrors?
    @State private var rating = 5
    @State private var comment = ""
    @State private var errors: ValidationErrors = [:]
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EvSheet(title: L("bookings.writeReview")) {
            FieldLabel(text: L("bookings.rating"))
            StarRatingInput(rating: $rating)
            EvTextField(label: L("bookings.comment"), text: $comment, error: errors["comment"].map { L($0) }, multiline: true, maxLength: 2000)
        } footer: {
            PrimaryButton(title: L("common.send"), isLoading: working) {
                Task {
                    working = true
                    let result = await onSend(rating, comment)
                    working = false
                    if let result { errors = result } else { dismiss() }
                }
            }
            .disabled(comment.trimmingCharacters(in: .whitespacesAndNewlines).count < 5)
        }
        .presentationDetents([.medium, .large])
    }
}

private struct PayBookingSheet: View {
    let amount: Int
    let currency: Currency
    let working: Bool
    let onPay: (PaymentMethod) async -> Void
    @State private var method: PaymentMethod = .CARD

    var body: some View {
        EvSheet(title: L("bookings.payNow")) {
            MoneyText(minor: amount, currency: currency, style: EvType.number)
            Text(L("booking.held")).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
            PaymentMethodPicker(method: $method, amount: amount)
        } footer: {
            PrimaryButton(title: L("bookings.payNow"), isLoading: working) { Task { await onPay(method) } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Guest / host bookings list.
struct BookingsView: View {
    @State private var role: BookingRole = .guest
    @State private var guestList = PagedList<Booking> { page in try await AppServices.shared.api.send(API.bookings(role: .guest, page: page)) }
    @State private var hostList = PagedList<Booking> { page in try await AppServices.shared.api.send(API.bookings(role: .host, page: page)) }
    @Environment(Router.self) private var router
    @Environment(RefreshBus.self) private var bus

    private var list: PagedList<Booking> { role == .guest ? guestList : hostList }

    var body: some View {
        RequireAuth {
            VStack(spacing: EvSpace.s3) {
                Segmented(options: BookingRole.allCases, selection: $role) { $0 == .guest ? L("bookings.asGuest") : L("bookings.asHost") }
                    .padding(.horizontal, EvSize.gutter)
                ScrollView {
                    LazyVStack(spacing: EvSpace.s3) {
                        if list.isInitialLoading {
                            ListSkeleton(rows: 4, rowHeight: 88)
                        } else if let e = list.error, list.isEmpty {
                            ErrorStateView(error: e) { Task { await list.refresh() } }
                        } else if list.isEmpty {
                            EmptyState(icon: "calendar", title: L("bookings.empty"))
                        } else {
                            ForEach(list.items) { b in
                                bookingRow(b)
                                    .onAppear { Task { await list.loadMoreIfNeeded(b) } }
                            }
                        }
                    }
                    .padding(.horizontal, EvSize.gutter)
                    .padding(.bottom, EvSpace.s6)
                }
                .refreshable { await list.refresh() }
            }
            .padding(.top, EvSpace.s2)
        }
        .evScreen(L("bookings.title"))
        .task(id: "\(role.rawValue)-\(bus.version(.bookings))") { await list.refresh() }
    }

    private func bookingRow(_ b: Booking) -> some View {
        Button {
            router.push(.booking(id: b.id))
        } label: {
            HStack(spacing: EvSpace.s3) {
                RemoteImage(url: AppServices.shared.api.mediaURL(b.listing.coverUrl))
                    .frame(width: 80, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    StatusPill(text: LE("bookingStatus", b.status.rawValue), tone: b.status.tone)
                    Text(b.listing.title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(1)
                    Text("\(DateText.isoDayShort(b.checkIn)) → \(DateText.isoDayShort(b.checkOut)) · \(L("common.nights", ["n": b.nights]))")
                        .font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    Text(role == .host ? "\(b.guest.name) · \(Format.money(b.hostPayout, b.currency))" : Format.money(b.total, b.currency))
                        .font(.ev(EvType.label)).foregroundStyle(EvColor.ink)
                }
                Spacer(minLength: 0)
            }
            .evCard(padding: EvSpace.s3, radius: EvRadius.lg)
        }
        .buttonStyle(EvPressStyle())
    }
}
