import Foundation
import Observation
import EvTapCore

@MainActor
@Observable
final class ListingDetailViewModel {
    let listingId: String
    private(set) var state: Loadable<ListingDetail> = .idle
    private(set) var similar: [ListingCard] = []
    private(set) var reviews: [Review] = []
    private(set) var reviewsLoading = false
    /// Full phone after `POST /listings/:id/phone`.
    private(set) var phone: String?
    private(set) var revealing = false

    init(listingId: String) { self.listingId = listingId }

    var listing: ListingDetail? { state.value }

    func load() async {
        let api = AppServices.shared.api
        if state.value == nil { state = .loading }
        do {
            let l = try await api.send(API.listing(listingId))
            state = .loaded(l)
            if l.isOwner, let own = l.contactPhone { phone = own }
            let id = listingId
            async let sim = Self.fetchSimilar(api, id)
            if l.dealType == .RENT_DAILY { await loadReviews() }
            similar = await sim
        } catch {
            if state.value == nil { state = .failed(error) } else { AppServices.shared.toast.error(error) }
        }
    }

    private nonisolated static func fetchSimilar(_ api: APIClient, _ id: String) async -> [ListingCard] {
        (try? await api.send(API.similar(id))) ?? []
    }

    func loadReviews() async {
        reviewsLoading = true
        defer { reviewsLoading = false }
        let page = try? await AppServices.shared.api.send(API.reviews(listingId, page: 1, pageSize: 3))
        if let page { reviews = page.items }
    }

    /// Reveals (and caches) the owner's phone; counts a phone view server-side.
    func revealPhone() async -> String? {
        if let phone { return phone }
        revealing = true
        defer { revealing = false }
        do {
            let r = try await AppServices.shared.api.send(API.revealPhone(listingId))
            phone = r.phone
            AppServices.shared.toast.show(L("listing.phoneRevealed"))
            return r.phone
        } catch {
            AppServices.shared.toast.error(error)
            return nil
        }
    }

    func report(reason: ReportReason, comment: String) async -> Bool {
        do {
            let c = comment.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await AppServices.shared.api.send(API.reportListing(listingId, ReportInput(reason: reason, comment: c.isEmpty ? nil : String(c.prefix(1000)))))
            AppServices.shared.toast.show(L("report.sent"), kind: .success)
            return true
        } catch {
            AppServices.shared.toast.error(error)
            return false
        }
    }

    /// Rows of the "Details" card (label, value) — only those with a value.
    func factRows(_ l: ListingDetail) -> [(String, String)] {
        let daily = l.dealType == .RENT_DAILY
        let sale = l.dealType == .SALE
        let rows: [(String, String?)] = [
            (L("listing.dealType"), LE("dealType", l.dealType.rawValue)),
            (L("listing.propertyType"), LE("propertyType", l.propertyType.rawValue)),
            (L("listing.buildingType"), l.buildingType.map { LE("buildingType", $0.rawValue) }),
            (L("listing.area"), l.area > 0 ? "\(Format.number(l.area)) \(L("common.m2"))" : nil),
            (L("listing.landArea"), l.landArea.map { "\(Format.number($0)) \(L("common.sot"))" }),
            (L("listing.rooms"), l.rooms.map(String.init)),
            (L("listing.bathrooms"), l.bathrooms.map(String.init)),
            (L("listing.floor"), l.floor.map { f in l.totalFloors.map { "\(f) / \($0)" } ?? "\(f)" }),
            (L("listing.yearBuilt"), l.yearBuilt.map(String.init)),
            (L("listing.ceilingHeight"), l.ceilingHeight.map { "\(Format.number($0)) m" }),
            (L("listing.repair"), l.repair.map { LE("repair", $0.rawValue) }),
            (L("listing.document"), sale ? (l.hasDocument ? L("common.yes") : L("common.no")) : nil),
            (L("listing.mortgage"), sale ? (l.mortgageAvailable ? L("common.yes") : L("common.no")) : nil),
            (L("listing.maxGuests"), daily ? l.maxGuests.map(String.init) : nil),
            (L("listing.minNights"), daily ? l.minNights.map(String.init) : nil),
            (L("listing.checkInTime"), daily ? l.checkInTime : nil),
            (L("listing.checkOutTime"), daily ? l.checkOutTime : nil),
        ]
        return rows.compactMap { k, v in v.map { (k, $0) } }
    }
}
