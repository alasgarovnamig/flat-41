import Foundation
import Observation
import EvTapCore

/// Loading state of a single resource.
enum Loadable<T> {
    case idle
    case loading
    case loaded(T)
    case failed(Error)

    var value: T? {
        if case .loaded(let v) = self { return v }
        return nil
    }

    var error: Error? {
        if case .failed(let e) = self { return e }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

extension Loadable: Sendable where T: Sendable {}

/// Infinite list over a `Paginated<T>` endpoint (pull to refresh + load more when the last rows appear).
@MainActor
@Observable
final class PagedList<T: Decodable & Sendable & Identifiable> {
    private(set) var items: [T] = []
    private(set) var total: Int?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var error: Error?
    @ObservationIgnored private var page = 0
    @ObservationIgnored private var hasMore = true
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private let fetch: @MainActor (Int) async throws -> Paginated<T>

    init(fetch: @escaping @MainActor (Int) async throws -> Paginated<T>) {
        self.fetch = fetch
    }

    var isEmpty: Bool { items.isEmpty }
    /// First load still running (show skeletons).
    var isInitialLoading: Bool { isLoading && items.isEmpty }

    func refresh() async {
        generation += 1
        let gen = generation
        isLoading = true
        error = nil
        do {
            let p = try await fetch(1)
            guard gen == generation else { return }
            items = p.items
            total = p.total
            page = 1
            hasMore = p.hasMore
        } catch is CancellationError {
        } catch {
            guard gen == generation else { return }
            self.error = error
        }
        if gen == generation { isLoading = false }
    }

    /// Call from `.onAppear` of each row; fetches the next page near the end.
    func loadMoreIfNeeded(_ item: T) async {
        guard hasMore, !isLoading, !isLoadingMore, let idx = items.firstIndex(where: { $0.id == item.id }), idx >= items.count - 4 else { return }
        let gen = generation
        isLoadingMore = true
        defer { if gen == generation { isLoadingMore = false } }
        do {
            let p = try await fetch(page + 1)
            guard gen == generation else { return }
            let known = Set(items.map(\.id))
            items += p.items.filter { !known.contains($0.id) }
            page += 1
            hasMore = p.hasMore
            total = p.total
        } catch {
            // keep what we have; the next appearance retries
        }
    }

    func remove(where predicate: (T) -> Bool) { items.removeAll(where: predicate) }

    func replace(_ item: T) {
        if let i = items.firstIndex(where: { $0.id == item.id }) { items[i] = item }
    }
}
