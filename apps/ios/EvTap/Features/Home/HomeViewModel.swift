import Foundation
import Observation
import EvTapCore

@MainActor
@Observable
final class HomeViewModel {
    private(set) var premium: Loadable<[ListingCard]> = .idle
    private(set) var vip: Loadable<[ListingCard]> = .idle
    private(set) var latest: Loadable<[ListingCard]> = .idle
    private(set) var banners: [Banner] = []
    /// Stat strip: active listings by deal type (totals of `GET /listings?dealType=…&pageSize=1`).
    private(set) var counts: [DealType: Int] = [:]

    func load() async {
        let api = AppServices.shared.api
        if premium.value == nil { premium = .loading }
        if vip.value == nil { vip = .loading }
        if latest.value == nil { latest = .loading }
        async let p = Self.result { try await api.send(API.featured(.premium, limit: 12)) }
        async let v = Self.result { try await api.send(API.featured(.vip, limit: 6)) }
        async let l = Self.result { try await api.send(API.listings(ListingFilters(), page: 1, pageSize: 10)).items }
        async let b = Self.result { try await api.send(API.banners(.MOBILE_HOME)) }
        async let c = Self.counts(api)
        premium = await p
        vip = await v
        latest = await l
        banners = (await b).value ?? []
        counts = await c
    }

    func bannerTapped(_ banner: Banner) {
        let api = AppServices.shared.api
        let id = banner.id
        Task { _ = try? await api.send(API.bannerClick(id)) }
    }

    private nonisolated static func result<T: Sendable>(_ op: @escaping @Sendable () async throws -> T) async -> Loadable<T> {
        do { return .loaded(try await op()) } catch { return .failed(error) }
    }

    private nonisolated static func counts(_ api: APIClient) async -> [DealType: Int] {
        await withTaskGroup(of: (DealType, Int?).self) { group in
            for deal in DealType.allCases {
                group.addTask {
                    let page = try? await api.send(API.listings(ListingFilters(dealType: deal), page: 1, pageSize: 1))
                    return (deal, page?.total)
                }
            }
            var out: [DealType: Int] = [:]
            for await (deal, total) in group {
                if let total { out[deal] = total }
            }
            return out
        }
    }
}
