package az.evtap.core.search

import az.evtap.core.model.MapPoint
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/** One marker on the map: a single listing (price pill) or a cluster (black circle with a count). */
sealed interface MapMarker {
    val key: String
    val lat: Double
    val lng: Double

    data class Single(val point: MapPoint) : MapMarker {
        override val key get() = point.id
        override val lat get() = point.lat
        override val lng get() = point.lng
    }

    data class Cluster(override val key: String, override val lat: Double, override val lng: Double, val points: List<MapPoint>) : MapMarker {
        val count: Int get() = points.size
        val minPrice: Long get() = points.minOf { it.price }
        val maxPrice: Long get() = points.maxOf { it.price }
    }
}

/**
 * Screen-space grid clustering (Web-Mercator pixels at the current zoom). Points within one [cellPx] cell merge
 * into a cluster positioned at their centroid. Deterministic, O(n), no Android dependencies — ≤ 500 points per
 * the `/listings/map` contract.
 */
object MapClustering {
    private const val TILE = 256.0

    fun cluster(points: List<MapPoint>, zoom: Float, cellPx: Double = 72.0, maxZoomToCluster: Float = 16.5f): List<MapMarker> {
        if (zoom >= maxZoomToCluster) return points.map { MapMarker.Single(it) }
        val scale = TILE * 2.0.pow(zoom.toDouble())
        val cells = LinkedHashMap<Pair<Long, Long>, MutableList<MapPoint>>()
        for (p in points) {
            val x = (p.lng + 180.0) / 360.0 * scale
            val sinLat = kotlin.math.sin(p.lat * PI / 180.0).coerceIn(-0.9999, 0.9999)
            val y = (0.5 - ln((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * scale
            val key = floor(x / cellPx).toLong() to floor(y / cellPx).toLong()
            cells.getOrPut(key) { mutableListOf() }.add(p)
        }
        return cells.map { (cell, ps) ->
            if (ps.size == 1) MapMarker.Single(ps[0])
            else MapMarker.Cluster("c${cell.first}_${cell.second}_${ps.size}", ps.sumOf { it.lat } / ps.size, ps.sumOf { it.lng } / ps.size, ps)
        }
    }

    /** Zoom level that fits [spanDeg] degrees of longitude into [widthPx] pixels (used for the "zoom into cluster" action). */
    fun zoomForSpan(spanDeg: Double, widthPx: Double): Float {
        if (spanDeg <= 0) return 16f
        return (ln(widthPx * 360.0 / (spanDeg * TILE)) / ln(2.0)).toFloat().coerceIn(3f, 18f)
    }
}
