import AuthenticationServices
import SwiftUI
import EvTapCore

/// Daily-rent booking: range calendar (unavailable nights disabled), guests stepper, live quote,
/// wallet / card payment → bank page → payment result.
struct BookingFlowView: View {
    @State private var vm: BookingFlowViewModel
    @Environment(\.webAuthenticationSession) private var webAuth
    @Environment(CatalogStore.self) private var catalog

    init(listingId: String) {
        _vm = State(initialValue: BookingFlowViewModel(listingId: listingId))
    }

    var body: some View {
        Group {
            switch vm.listing {
            case .loaded(let l):
                content(l)
            case .failed(let error):
                ErrorStateView(error: error) { Task { await vm.load() } }
            default:
                LoadingView()
            }
        }
        .evScreen(L("booking.title"))
        .task { if vm.detail == nil { await vm.load() } }
    }

    private func content(_ l: ListingDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s5) {
                HStack(spacing: EvSpace.s3) {
                    RemoteImage(url: AppServices.shared.api.mediaURL(l.coverUrl))
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(l.title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(2)
                        MoneyText(listingPrice: l.price, currency: l.currency, period: .DAY, style: EvType.bodyStrong)
                    }
                }
                .evCard(padding: EvSpace.s3, radius: EvRadius.lg)

                HStack(spacing: EvSpace.s2) {
                    dateBox(L("booking.checkIn"), vm.checkIn)
                    dateBox(L("booking.checkOut"), vm.checkOut)
                }
                Text(hint)
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)

                Card {
                    VStack(alignment: .leading, spacing: EvSpace.s3) {
                        CalendarLegend(items: [(EvColor.surfaceSunken, "booking.legendBooked", true), (EvColor.ink, "booking.legendSelected", false)])
                        MonthCalendar(from: vm.today, months: BookingFlowViewModel.months, state: vm.dayState, onTap: vm.tap)
                    }
                }

                StepperRow(title: L("booking.guests"), value: $vm.guests, range: 1...max(1, vm.maxGuests),
                           hint: l.maxGuests.map { L("booking.maxGuests", ["n": $0]) })
                    .evCard(padding: EvSpace.s4, radius: EvRadius.lg)

                if let b = vm.breakdown {
                    Card(title: L("booking.priceDetails")) {
                        VStack(spacing: 0) {
                            KeyValueRow(key: L("booking.nightsTimes", ["price": Format.price(vm.quote?.nightlyPrice ?? l.price, l.currency), "n": vm.nights]),
                                        value: Format.money(b.subtotal, l.currency))
                            KeyValueRow(key: L("booking.serviceFee"), value: Format.money(b.fee, l.currency))
                            Rectangle().fill(EvColor.hairline).frame(height: 1).padding(.vertical, 6)
                            KeyValueRow(key: L("booking.total"), value: Format.money(b.total, l.currency), bold: true)
                            if let q = vm.quote, !q.available {
                                NoticeBanner(text: q.unavailableReason ?? L("booking.unavailable"), tone: .danger, icon: "calendar.badge.exclamationmark")
                                    .padding(.top, EvSpace.s2)
                            }
                        }
                    }
                    PaymentMethodPicker(method: $vm.method, amount: b.total)
                }

                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(text: L("booking.policyTitle"))
                    Text(L("booking.policyText", ["h": catalog.settings.freeCancellationHours]))
                        .font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    Text(L("booking.held")).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                }
            }
            .padding(EvSize.gutter)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: EvSpace.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    if let b = vm.breakdown {
                        MoneyText(minor: b.total, currency: l.currency, style: EvType.h3)
                        Text("\(L("common.nights", ["n": vm.nights])) · \(L("common.guests", ["n": vm.guests]))")
                            .font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    } else {
                        Text("—").evText(EvType.h3)
                    }
                }
                Spacer()
                PrimaryButton(title: L("booking.bookAndPay"), fullWidth: false, isLoading: vm.submitting || vm.quoting) {
                    Task {
                        if let res = await vm.book() {
                            await AppServices.shared.payments.complete(res.checkout, context: PaymentContext(listingId: l.id, bookingId: res.booking.id), webAuth: webAuth)
                        }
                    }
                }
                .disabled(!vm.canBook)
            }
            .padding(.horizontal, EvSize.gutter)
            .padding(.vertical, EvSpace.s3)
            .evGlass(in: Rectangle())
        }
    }

    private var hint: String {
        var s: String
        if vm.checkIn == nil { s = L("booking.selectDates") } else if vm.checkOut == nil { s = L("booking.selectCheckOut") } else { s = L("common.nights", ["n": vm.nights]) }
        if vm.minNights > 1 { s += " · " + L("booking.minNights", ["n": vm.minNights]) }
        return s
    }

    private func dateBox(_ label: String, _ iso: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
            Text(iso.map { DateText.isoDay($0) } ?? "—").font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
        }
        .padding(EvSpace.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(EvColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).strokeBorder(iso == nil ? EvColor.hairline : EvColor.ink, lineWidth: iso == nil ? 1 : 1.5))
        .accessibilityElement(children: .combine)
    }
}
