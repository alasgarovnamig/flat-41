import Foundation

/// Grid clustering for the search map (SwiftUI `Map` has no built-in annotation clustering).
/// Points closer than one grid cell (a fraction of the visible span) collapse into a cluster.
public enum MapClustering {
    public struct Cluster: Sendable, Hashable, Identifiable {
        public let id: String
        public let lat: Double
        public let lng: Double
        public let points: [MapPoint]
        public var isSingle: Bool { points.count == 1 }
        public var count: Int { points.count }
        /// Cheapest price in the cluster (shown on single pins).
        public var minPrice: Int { points.map(\.price).min() ?? 0 }
    }

    /// - Parameters:
    ///   - latSpan / lngSpan: visible span in degrees
    ///   - cells: grid cells across the shorter side (≈ how many pins fit side by side)
    public static func cluster(_ points: [MapPoint], latSpan: Double, lngSpan: Double, cells: Double = 7) -> [Cluster] {
        guard !points.isEmpty else { return [] }
        let cellLat = max(latSpan / cells, 1e-6)
        let cellLng = max(lngSpan / cells, 1e-6)
        var buckets: [String: [MapPoint]] = [:]
        var order: [String] = []
        for p in points {
            let key = "\(Int((p.lat / cellLat).rounded(.down))):\(Int((p.lng / cellLng).rounded(.down)))"
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(p)
        }
        return order.map { key in
            let ps = buckets[key]!
            let lat = ps.map(\.lat).reduce(0, +) / Double(ps.count)
            let lng = ps.map(\.lng).reduce(0, +) / Double(ps.count)
            let id = ps.count == 1 ? ps[0].id : "c:" + ps.map(\.id).sorted().joined(separator: ",").prefix(64)
            return Cluster(id: id, lat: lat, lng: lng, points: ps)
        }
    }
}
