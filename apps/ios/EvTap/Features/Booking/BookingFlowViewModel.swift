import Foundation
import Observation
import EvTapCore

@MainActor
@Observable
final class BookingFlowViewModel {
    static let months = 6

    let listingId: String
    private(set) var listing: Loadable<ListingDetail> = .idle
    private(set) var availability: Availability?
    private(set) var quote: BookingQuote?
    private(set) var quoting = false
    private(set) var submitting = false
    var checkIn: String?
    var checkOut: String?
    var guests = 1 { didSet { if guests != oldValue { requestQuote() } } }
    var method: PaymentMethod = .CARD

    @ObservationIgnored private var unavailable: Set<String> = []
    @ObservationIgnored private var quoteTask: Task<Void, Never>?
    let today = ISODay.today()

    init(listingId: String) { self.listingId = listingId }

    var detail: ListingDetail? { listing.value }
    var minNights: Int { max(1, detail?.minNights ?? 1) }
    var maxGuests: Int { detail?.maxGuests ?? 16 }
    var nights: Int {
        guard let a = checkIn, let b = checkOut else { return 0 }
        return ISODay.nightsBetween(a, b)
    }

    /// Server quote when available, else the shared `calcBooking` preview.
    var breakdown: (subtotal: Int, fee: Int, total: Int)? {
        if let q = quote { return (q.subtotal, q.guestFee, q.total) }
        guard let d = detail, nights > 0 else { return nil }
        let b = Pricing.calcBooking(nightlyPriceMajor: d.price, nights: nights, settings: AppServices.shared.catalog.settings)
        return (b.subtotal, b.guestFee, b.total)
    }

    var canBook: Bool { nights > 0 && !quoting && quote?.available != false && !submitting }

    func load() async {
        let api = AppServices.shared.api
        listing = .loading
        do {
            let d = try await api.send(API.listing(listingId))
            listing = .loaded(d)
            guests = min(guests, d.maxGuests ?? 16)
            let to = ISODay.adding(Self.months * 31, to: today)
            let a = try await api.send(API.availability(listingId, from: today, to: to))
            availability = a
            unavailable = a.unavailableNights
        } catch {
            listing = .failed(error)
        }
    }

    // MARK: Calendar

    /// First unavailable night after check-in: check-out may be ON that day (guest leaves that morning), not after it.
    private var firstBlockedAfterCheckIn: String? {
        guard let a = checkIn else { return nil }
        return unavailable.filter { $0 > a }.min()
    }

    func dayState(_ iso: String) -> CalendarDayState {
        if iso < today { return .past }
        if iso == checkIn { return checkOut == nil ? .selectedSingle : .selectedStart }
        if iso == checkOut { return .selectedEnd }
        if let a = checkIn, let b = checkOut, iso > a, iso < b { return .inRange }
        if let a = checkIn, checkOut == nil, iso > a {
            if let blocked = firstBlockedAfterCheckIn, iso > blocked { return .disabled }
            if ISODay.nightsBetween(a, iso) < minNights { return .disabled }
            return .normal
        }
        return unavailable.contains(iso) ? .booked : .normal
    }

    func tap(_ iso: String) {
        if let a = checkIn, checkOut == nil, iso > a {
            if dayState(iso) == .normal {
                checkOut = iso
                requestQuote()
            }
            return
        }
        guard !unavailable.contains(iso), iso >= today else { return }
        checkIn = iso
        checkOut = nil
        quote = nil
    }

    // MARK: Quote / book

    func requestQuote() {
        quoteTask?.cancel()
        guard let a = checkIn, let b = checkOut else { quote = nil; return }
        let input = BookingQuoteInput(listingId: listingId, checkIn: a, checkOut: b, guests: guests)
        quoting = true
        quoteTask = Task { [weak self] in
            let q = try? await AppServices.shared.api.send(API.quote(input))
            guard let self, !Task.isCancelled else { return }
            self.quote = q
            self.quoting = false
        }
    }

    func book() async -> CreateBookingResponse? {
        guard let a = checkIn, let b = checkOut else { return nil }
        submitting = true
        defer { submitting = false }
        do {
            let res = try await AppServices.shared.api.send(API.createBooking(CreateBookingInput(
                listingId: listingId, checkIn: a, checkOut: b, guests: guests, method: method, returnUrl: PaymentCoordinator.returnURL)))
            AppServices.shared.bus.bump(.bookings)
            return res
        } catch {
            AppServices.shared.toast.error(error)
            if (error as? APIError)?.code == .LISTING_NOT_AVAILABLE { await load() }
            return nil
        }
    }
}
