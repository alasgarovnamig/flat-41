package az.evtap.core.search

import az.evtap.core.model.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Strongly typed mirror of `listingSearchSchema` (minus page / pageSize / bbox, which the screens add).
 * Arrays travel as CSV (`rooms=1,2,3`), booleans as `true`, matching the schema's preprocessors.
 */
data class ListingFilters(
    val q: String? = null,
    val dealType: DealType? = null,
    val propertyType: Set<PropertyType> = emptySet(),
    val buildingType: BuildingType? = null,
    val country: CountryCode? = null,
    val cityId: String? = null,
    val districtId: Set<String> = emptySet(),
    val metroId: Set<String> = emptySet(),
    val priceMin: Long? = null,
    val priceMax: Long? = null,
    val currency: Currency? = null,
    val areaMin: Double? = null,
    val areaMax: Double? = null,
    /** 1..5 where 5 means "5+". */
    val rooms: Set<Int> = emptySet(),
    val floorMin: Int? = null,
    val floorMax: Int? = null,
    val notFirstFloor: Boolean = false,
    val notLastFloor: Boolean = false,
    val repair: Set<RepairType> = emptySet(),
    val hasDocument: Boolean = false,
    val mortgageAvailable: Boolean = false,
    val amenities: Set<Amenity> = emptySet(),
    val ownerType: OwnerType? = null,
    val hasPhotos: Boolean = false,
    val verified: Boolean = false,
    val agencyId: String? = null,
    val ownerId: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val guests: Int? = null,
    val sort: ListingSort = ListingSort.DATE_DESC,
) {
    /** Number of active refinements shown as a badge on the filter button (q, dealType and sort have their own UI). */
    val activeCount: Int
        get() = listOf(
            propertyType.isNotEmpty(), buildingType != null, country != null, cityId != null, districtId.isNotEmpty(), metroId.isNotEmpty(),
            priceMin != null, priceMax != null, currency != null, areaMin != null, areaMax != null, rooms.isNotEmpty(), floorMin != null,
            floorMax != null, notFirstFloor, notLastFloor, repair.isNotEmpty(), hasDocument, mortgageAvailable, amenities.isNotEmpty(),
            ownerType != null, hasPhotos, verified, checkIn != null, checkOut != null, guests != null,
        ).count { it }

    /** Swaps inverted ranges and drops blank text instead of sending a query the API would reject. */
    fun normalized(): ListingFilters {
        fun <T : Comparable<T>> fix(a: T?, b: T?): Pair<T?, T?> = if (a != null && b != null && a > b) b to a else a to b
        val (pMin, pMax) = fix(priceMin, priceMax)
        val (aMin, aMax) = fix(areaMin, areaMax)
        val (fMin, fMax) = fix(floorMin, floorMax)
        val validDates = checkIn != null && checkOut != null && checkOut > checkIn
        return copy(
            q = q?.trim()?.takeIf { it.isNotEmpty() }?.take(100),
            priceMin = pMin, priceMax = pMax, areaMin = aMin, areaMax = aMax, floorMin = fMin, floorMax = fMax,
            checkIn = if (validDates) checkIn else null,
            checkOut = if (validDates) checkOut else null,
            // daily-rent-only refinements
            guests = if (dealType == DealType.RENT_DAILY || dealType == null) guests else null,
            // building type only makes sense for apartments
            buildingType = if (propertyType.isEmpty() || PropertyType.APARTMENT in propertyType) buildingType else null,
        )
    }

    /** Query parameters for GET /listings and /listings/map. */
    fun toQuery(): Map<String, String> {
        val f = normalized()
        val m = LinkedHashMap<String, String>()
        fun put(k: String, v: Any?) {
            when (v) {
                null -> Unit
                is Boolean -> if (v) m[k] = "true"
                is Collection<*> -> if (v.isNotEmpty()) m[k] = v.joinToString(",") { (it as? Enum<*>)?.name ?: it.toString() }
                is Enum<*> -> m[k] = v.name
                is Double -> m[k] = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
                else -> m[k] = v.toString()
            }
        }
        put("q", f.q)
        put("dealType", f.dealType)
        put("propertyType", f.propertyType.sortedBy { it.ordinal })
        put("buildingType", f.buildingType)
        put("country", f.country)
        put("cityId", f.cityId)
        put("districtId", f.districtId.sorted())
        put("metroId", f.metroId.sorted())
        put("priceMin", f.priceMin)
        put("priceMax", f.priceMax)
        put("currency", f.currency)
        put("areaMin", f.areaMin)
        put("areaMax", f.areaMax)
        put("rooms", f.rooms.sorted())
        put("floorMin", f.floorMin)
        put("floorMax", f.floorMax)
        put("notFirstFloor", f.notFirstFloor)
        put("notLastFloor", f.notLastFloor)
        put("repair", f.repair.sortedBy { it.ordinal })
        put("hasDocument", f.hasDocument)
        put("mortgageAvailable", f.mortgageAvailable)
        put("amenities", f.amenities.sortedBy { it.ordinal })
        put("ownerType", f.ownerType)
        put("hasPhotos", f.hasPhotos)
        put("verified", f.verified)
        put("agencyId", f.agencyId)
        put("ownerId", f.ownerId)
        put("checkIn", f.checkIn)
        put("checkOut", f.checkOut)
        put("guests", f.guests)
        m["sort"] = f.sort.wire
        return m
    }

    fun toPageQuery(page: Int, pageSize: Int): Map<String, String> = toQuery() + mapOf("page" to page.toString(), "pageSize" to pageSize.toString())

    /** `query` object stored with a saved search (same keys as the URL query, arrays as JSON arrays). */
    fun toJson(): JsonObject {
        val q = toQuery()
        val arrays = setOf("propertyType", "districtId", "metroId", "rooms", "repair", "amenities")
        val numbers = setOf("priceMin", "priceMax", "areaMin", "areaMax", "floorMin", "floorMax", "guests")
        return buildJsonObject {
            for ((k, v) in q) when {
                k in arrays -> put(k, JsonArray(v.split(',').map { s -> s.toIntOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(s) }))
                k in numbers -> put(k, v.toLongOrNull()?.let { JsonPrimitive(it) } ?: v.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(v))
                v == "true" -> put(k, true)
                else -> put(k, v)
            }
        }
    }

    companion object {
        /** Saved-search `query` (also accepts CSV strings, as the web stores them) → filters. Unknown values are ignored. */
        fun fromJson(o: JsonObject): ListingFilters {
            fun str(k: String): String? = (o[k] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
            fun list(k: String): List<String> = when (val e: JsonElement? = o[k]) {
                is JsonArray -> e.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                is JsonPrimitive -> e.contentOrNull?.split(',')?.filter { it.isNotBlank() } ?: emptyList()
                else -> emptyList()
            }
            fun bool(k: String): Boolean = (o[k] as? JsonPrimitive)?.let { it.booleanOrNull ?: (it.contentOrNull == "true" || it.contentOrNull == "1") } ?: false
            fun long(k: String): Long? = (o[k] as? JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toDoubleOrNull()?.toLong() }
            fun dbl(k: String): Double? = (o[k] as? JsonPrimitive)?.let { it.doubleOrNull ?: it.contentOrNull?.toDoubleOrNull() }
            fun int(k: String): Int? = (o[k] as? JsonPrimitive)?.let { it.intOrNull ?: it.contentOrNull?.toDoubleOrNull()?.toInt() }
            return ListingFilters(
                q = str("q"),
                dealType = enumOrNull<DealType>(str("dealType")),
                propertyType = list("propertyType").mapNotNull { enumOrNull<PropertyType>(it) }.toSet(),
                buildingType = enumOrNull<BuildingType>(str("buildingType")),
                country = enumOrNull<CountryCode>(str("country")),
                cityId = str("cityId"),
                districtId = list("districtId").toSet(),
                metroId = list("metroId").toSet(),
                priceMin = long("priceMin"),
                priceMax = long("priceMax"),
                currency = enumOrNull<Currency>(str("currency")),
                areaMin = dbl("areaMin"),
                areaMax = dbl("areaMax"),
                rooms = list("rooms").mapNotNull { it.toIntOrNull() }.toSet(),
                floorMin = int("floorMin"),
                floorMax = int("floorMax"),
                notFirstFloor = bool("notFirstFloor"),
                notLastFloor = bool("notLastFloor"),
                repair = list("repair").mapNotNull { enumOrNull<RepairType>(it) }.toSet(),
                hasDocument = bool("hasDocument"),
                mortgageAvailable = bool("mortgageAvailable"),
                amenities = list("amenities").mapNotNull { enumOrNull<Amenity>(it) }.toSet(),
                ownerType = enumOrNull<OwnerType>(str("ownerType")),
                hasPhotos = bool("hasPhotos"),
                verified = bool("verified"),
                agencyId = str("agencyId"),
                ownerId = str("ownerId"),
                checkIn = str("checkIn"),
                checkOut = str("checkOut"),
                guests = int("guests"),
                sort = ListingSort.fromWire(str("sort")),
            )
        }

        /** Deep link / URL query (`evtap://search?dealType=SALE&cityId=baku`) → filters. */
        fun fromQuery(params: Map<String, String>): ListingFilters =
            fromJson(JsonObject(params.mapValues { JsonPrimitive(it.value) }))
    }
}

inline fun <reified E : Enum<E>> enumOrNull(name: String?): E? = name?.let { n -> enumValues<E>().firstOrNull { it.name == n } }

/** "minLng,minLat,maxLng,maxLat" for GET /listings/map. */
data class BBox(val minLng: Double, val minLat: Double, val maxLng: Double, val maxLat: Double) {
    fun toQueryValue(): String = listOf(minLng, minLat, maxLng, maxLat).joinToString(",") { String.format(java.util.Locale.US, "%.5f", it) }
}
