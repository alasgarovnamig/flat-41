import Foundation
import MapKit
import Observation
import EvTapCore

@MainActor
@Observable
final class SearchViewModel {
    static let pageSize = 20

    /// Applied filters (the text query is debounced into `filters.q`).
    private(set) var filters = ListingFilters()
    var queryText = "" {
        didSet { if queryText != oldValue { debounceQuery() } }
    }
    var mapMode = false {
        didSet { if mapMode != oldValue, mapMode { Task { await loadMap() } } }
    }

    let list: PagedList<ListingCard>

    // Map
    private(set) var points: [MapPoint] = []
    private(set) var clusters: [MapClustering.Cluster] = []
    private(set) var mapLoading = false
    var selectedPointId: String?
    @ObservationIgnored private var region: MKCoordinateRegion?
    @ObservationIgnored private var mapTask: Task<Void, Never>?
    @ObservationIgnored private var queryTask: Task<Void, Never>?
    @ObservationIgnored private var lastRequestId: UUID?

    init() {
        let holder = FiltersHolder()
        list = PagedList { page in
            try await AppServices.shared.api.send(API.listings(holder.filters, page: page, pageSize: SearchViewModel.pageSize))
        }
        self.holder = holder
    }

    /// The paged loader reads the current filters through this box (set before every refresh).
    @ObservationIgnored private let holder: FiltersHolder

    var selectedPoint: MapPoint? { points.first { $0.id == selectedPointId } }
    var mapLimitReached: Bool { points.count >= 500 }

    /// Initial map centre: selected city or Baku.
    var initialRegion: MKCoordinateRegion {
        let city = AppServices.shared.locations.city(filters.cityId ?? "baku") ?? AppServices.shared.locations.city("baku")
        let center = CLLocationCoordinate2D(latitude: city?.lat ?? 40.4093, longitude: city?.lng ?? 49.8671)
        return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18))
    }

    // MARK: Inputs

    func apply(_ new: ListingFilters) {
        var f = new.cleaned()
        f.q = filters.q
        setFilters(f)
    }

    func setDeal(_ deal: DealType?) {
        var f = filters
        f.dealType = f.dealType == deal ? nil : deal
        setFilters(f.cleaned())
    }

    func setSort(_ sort: ListingSort) {
        var f = filters
        f.sort = sort
        setFilters(f)
    }

    func resetFilters() { setFilters(filters.reset()) }

    /// Request from Home / saved search / deep link.
    func handle(_ request: SearchRequest?) -> Bool {
        guard let request, request.id != lastRequestId else { return false }
        lastRequestId = request.id
        queryTask?.cancel()
        queryText = request.filters.q ?? ""
        queryTask?.cancel()
        mapMode = request.mapMode
        setFilters(request.filters.cleaned(), force: true)
        return request.openFilters
    }

    func loadIfNeeded() async {
        if list.items.isEmpty && !list.isLoading && list.error == nil { await reload() }
    }

    func reload() async {
        holder.filters = filters
        if mapMode { await loadMap() }
        await list.refresh()
    }

    private func setFilters(_ f: ListingFilters, force: Bool = false) {
        guard force || f != filters else { return }
        filters = f
        selectedPointId = nil
        Task { await reload() }
    }

    private func debounceQuery() {
        queryTask?.cancel()
        let text = queryText
        queryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled, let self else { return }
            var f = self.filters
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            f.q = trimmed.isEmpty ? nil : trimmed
            self.setFilters(f)
        }
    }

    // MARK: Map

    func regionChanged(_ region: MKCoordinateRegion) {
        self.region = region
        mapTask?.cancel()
        mapTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await self?.loadMap()
        }
    }

    func loadMap() async {
        let r = region ?? initialRegion
        let bbox = BoundingBox(centerLat: r.center.latitude, centerLng: r.center.longitude,
                               latDelta: r.span.latitudeDelta, lngDelta: r.span.longitudeDelta)
        mapLoading = true
        defer { mapLoading = false }
        do {
            let pts = try await AppServices.shared.api.send(API.mapPoints(filters, bbox: bbox))
            guard !Task.isCancelled else { return }
            points = pts
            clusters = MapClustering.cluster(pts, latSpan: r.span.latitudeDelta, lngSpan: r.span.longitudeDelta)
            if let sel = selectedPointId, !pts.contains(where: { $0.id == sel }) { selectedPointId = nil }
        } catch is CancellationError {
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    // MARK: Saved search

    var defaultSearchName: String {
        let locations = AppServices.shared.locations
        let parts: [String?] = [
            filters.dealType.map { LE("dealType", $0.rawValue) },
            locations.city(filters.cityId)?.name.current,
            filters.priceMax.map { "≤ \(Format.price($0, filters.currency ?? .AZN))" },
            filters.q,
        ]
        let name = parts.compactMap { $0 }.joined(separator: ", ")
        return name.isEmpty ? L("search.title") : String(name.prefix(80))
    }

    func saveSearch(name: String, notify: Bool) async -> Bool {
        do {
            _ = try await AppServices.shared.api.send(API.createSavedSearch(SavedSearchInput(name: name, query: filters.savedQuery, notify: notify)))
            AppServices.shared.toast.show(L("search.searchSaved"), kind: .success)
            AppServices.shared.bus.bump(.savedSearches)
            return true
        } catch {
            AppServices.shared.toast.error(error)
            return false
        }
    }
}

/// Mutable box shared with the `PagedList` fetch closure (main-actor only).
@MainActor
final class FiltersHolder {
    var filters = ListingFilters()
}
