package az.evtap.core.listing

import az.evtap.core.format.Phone
import az.evtap.core.model.*
import az.evtap.core.validation.FieldError
import az.evtap.core.validation.Rules
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** A photo in the post wizard: local file being uploaded, or an already uploaded image. */
data class DraftPhoto(
    val key: String,
    val localUri: String? = null,
    val uploadId: String? = null,
    val url: String? = null,
    val progress: Float = 0f,
    val failed: Boolean = false,
) {
    val uploaded: Boolean get() = uploadId != null
}

/** Fields of the post wizard. Numbers stay strings while typing; [toJson] converts them. */
data class ListingDraft(
    val dealType: DealType? = null,
    val propertyType: PropertyType? = null,
    val buildingType: BuildingType? = null,
    val cityId: String? = "baku",
    val districtId: String? = null,
    val metroId: String? = null,
    val address: String = "",
    val lat: Double? = null,
    val lng: Double? = null,
    val area: String = "",
    val landArea: String = "",
    val rooms: String = "",
    val bathrooms: String = "",
    val floor: String = "",
    val totalFloors: String = "",
    val yearBuilt: String = "",
    val ceilingHeight: String = "",
    val repair: RepairType? = null,
    val hasDocument: Boolean = false,
    val mortgageAvailable: Boolean = false,
    val amenities: Set<Amenity> = emptySet(),
    val maxGuests: String = "",
    val minNights: String = "",
    val checkInTime: String = "14:00",
    val checkOutTime: String = "12:00",
    val houseRules: String = "",
    val photos: List<DraftPhoto> = emptyList(),
    val price: String = "",
    val currency: Currency = Currency.AZN,
    val title: String = "",
    val description: String = "",
    val contactName: String = "",
    /** National digits after the fixed +994 prefix. */
    val contactPhone: String = "",
) {
    val isDaily: Boolean get() = dealType == DealType.RENT_DAILY
    val needsRooms: Boolean get() = propertyType == PropertyType.APARTMENT || propertyType == PropertyType.HOUSE || propertyType == PropertyType.ROOM
    val hasFloors: Boolean get() = propertyType != PropertyType.LAND && propertyType != PropertyType.HOUSE && propertyType != PropertyType.GARAGE
    val hasLand: Boolean get() = propertyType == PropertyType.HOUSE || propertyType == PropertyType.LAND
    val uploading: Boolean get() = photos.any { !it.uploaded && !it.failed }

    /** Field name (as in createListingSchema) → error. Cross-field refinements are checked eagerly, like the old app. */
    fun validate(): Map<String, FieldError> {
        val e = LinkedHashMap<String, FieldError>()
        if (dealType == null) e["dealType"] = FieldError.Required
        if (propertyType == null) e["propertyType"] = FieldError.Required
        if (cityId.isNullOrBlank()) e["cityId"] = FieldError.Required
        if (address.trim().length > 200) e["address"] = FieldError.MaxLength(200)

        num(e, "area", area, 0.01, 100_000.0, required = true)
        if (hasLand) num(e, "landArea", landArea, 0.01, 100_000.0)
        int(e, "rooms", rooms, 0, 50, required = needsRooms)
        int(e, "bathrooms", bathrooms, 0, 20)
        if (hasFloors) {
            int(e, "floor", floor, -5, 200)
            int(e, "totalFloors", totalFloors, 1, 200)
            val f = floor.trim().toIntOrNull()
            val t = totalFloors.trim().toIntOrNull()
            if (f != null && t != null && f > t && "floor" !in e) e["floor"] = FieldError.FloorAboveTotal
        }
        int(e, "yearBuilt", yearBuilt, 1800, 2100)
        num(e, "ceilingHeight", ceilingHeight, 2.0, 10.0)
        if (isDaily) {
            int(e, "maxGuests", maxGuests, 1, 50, required = true)
            int(e, "minNights", minNights, 1, 365)
            Rules.time(checkInTime)?.let { e["checkInTime"] = it }
            Rules.time(checkOutTime)?.let { e["checkOutTime"] = it }
            if (houseRules.length > 2000) e["houseRules"] = FieldError.MaxLength(2000)
        }

        val uploaded = photos.count { it.uploaded }
        if (uploaded == 0) e["imageIds"] = FieldError.PhotosRequired
        else if (uploaded > MAX_PHOTOS) e["imageIds"] = FieldError.TooManyPhotos(MAX_PHOTOS)

        int(e, "price", price, 1, 1_000_000_000, required = true)
        Rules.text(title, 10, 120)?.let { e["title"] = it }
        Rules.text(description, 30, 5000)?.let { e["description"] = it }
        Rules.text(contactName, 2, 80)?.let { e["contactName"] = it }
        if (contactPhone.isBlank()) e["contactPhone"] = FieldError.Required
        else if (!Phone.isValid(Phone.fromLocalDigits(contactPhone))) e["contactPhone"] = FieldError.InvalidPhone
        return e
    }

    private fun num(e: MutableMap<String, FieldError>, key: String, v: String, min: Double, max: Double, required: Boolean = false) {
        val r = Rules.decimal(v)
        val n = r.getOrNull()
        when {
            r.isFailure -> e[key] = FieldError.InvalidNumber
            n == null -> if (required) e[key] = FieldError.Required
            n < min || n > max -> e[key] = FieldError.Range(min, max)
        }
    }

    private fun int(e: MutableMap<String, FieldError>, key: String, v: String, min: Long, max: Long, required: Boolean = false) {
        val r = Rules.integer(v)
        val n = r.getOrNull()
        when {
            r.isFailure -> e[key] = FieldError.InvalidNumber
            n == null -> if (required) e[key] = FieldError.Required
            n < min || n > max -> e[key] = FieldError.Range(min, max)
        }
    }

    /**
     * Body for POST /listings and PATCH /listings/:id. Explicit `null`s clear optional fields on edit; fields that do
     * not apply to the chosen type (e.g. guests for a sale) are sent as null, like the former mobile app.
     */
    fun toJson(): JsonObject = buildJsonObject {
        fun p(k: String, v: Any?) = put(k, when (v) {
            null -> JsonNull
            is Number -> JsonPrimitive(v)
            is Boolean -> JsonPrimitive(v)
            is Enum<*> -> JsonPrimitive(v.name)
            else -> JsonPrimitive(v.toString())
        })
        fun dec(v: String) = Rules.decimal(v).getOrNull()
        fun int(v: String) = Rules.integer(v).getOrNull()
        p("dealType", dealType)
        p("propertyType", propertyType)
        p("buildingType", if (propertyType == PropertyType.APARTMENT) buildingType else null)
        p("title", title.trim())
        p("description", description.trim())
        p("price", int(price))
        p("currency", currency)
        p("cityId", cityId)
        p("districtId", districtId)
        p("metroId", metroId)
        p("address", address.trim().ifEmpty { null })
        p("lat", lat)
        p("lng", lng)
        p("area", dec(area))
        p("landArea", if (hasLand) dec(landArea) else null)
        p("rooms", int(rooms)?.toInt())
        p("bathrooms", int(bathrooms)?.toInt())
        p("floor", if (hasFloors) int(floor)?.toInt() else null)
        p("totalFloors", if (hasFloors) int(totalFloors)?.toInt() else null)
        p("yearBuilt", int(yearBuilt)?.toInt())
        p("ceilingHeight", dec(ceilingHeight))
        p("repair", repair)
        p("hasDocument", hasDocument)
        p("mortgageAvailable", mortgageAvailable)
        put("amenities", JsonArray(amenities.sortedBy { it.ordinal }.map { JsonPrimitive(it.name) }))
        p("maxGuests", if (isDaily) int(maxGuests)?.toInt() else null)
        p("minNights", if (isDaily) int(minNights)?.toInt() else null)
        p("checkInTime", if (isDaily) checkInTime.ifBlank { null } else null)
        p("checkOutTime", if (isDaily) checkOutTime.ifBlank { null } else null)
        p("houseRules", if (isDaily) houseRules.trim().ifEmpty { null } else null)
        p("contactName", contactName.trim())
        p("contactPhone", Phone.fromLocalDigits(contactPhone))
        put("imageIds", JsonArray(photos.mapNotNull { it.uploadId }.map { JsonPrimitive(it) }))
    }

    companion object {
        const val MAX_PHOTOS = 30

        /** Field → wizard step (0 type, 1 location, 2 details, 3 photos, 4 price & contact, 5 review). */
        val STEP_FIELDS: List<Set<String>> = listOf(
            setOf("dealType", "propertyType", "buildingType"),
            setOf("cityId", "districtId", "metroId", "address", "lat", "lng"),
            setOf("area", "landArea", "rooms", "bathrooms", "floor", "totalFloors", "yearBuilt", "ceilingHeight", "repair", "amenities",
                "maxGuests", "minNights", "checkInTime", "checkOutTime", "houseRules"),
            setOf("imageIds"),
            setOf("price", "currency", "title", "description", "contactName", "contactPhone"),
            emptySet(),
        )

        fun firstStepWithError(errors: Map<String, FieldError>): Int? =
            STEP_FIELDS.indexOfFirst { fields -> fields.any { it in errors } }.takeIf { it >= 0 }

        fun errorsForStep(errors: Map<String, FieldError>, step: Int): Map<String, FieldError> =
            errors.filterKeys { it in STEP_FIELDS.getOrElse(step) { emptySet() } }

        fun new(contactName: String, phone: String?): ListingDraft = ListingDraft(contactName = contactName, contactPhone = Phone.toLocalDigits(phone))

        /** Edit mode: ListingDetail → draft. Images keep their `uploadId` (sent back in imageIds). */
        fun fromListing(l: ListingDetail, fallbackPhone: String?): ListingDraft {
            fun s(n: Number?): String = when (n) {
                null -> ""
                is Double -> if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()
                else -> n.toString()
            }
            return ListingDraft(
                dealType = l.dealType, propertyType = l.propertyType, buildingType = l.buildingType, cityId = l.cityId,
                districtId = l.districtId, metroId = l.metroId, address = l.address ?: "", lat = l.lat, lng = l.lng,
                area = s(l.area), landArea = s(l.landArea), rooms = s(l.rooms), bathrooms = s(l.bathrooms), floor = s(l.floor),
                totalFloors = s(l.totalFloors), yearBuilt = s(l.yearBuilt), ceilingHeight = s(l.ceilingHeight), repair = l.repair,
                hasDocument = l.hasDocument, mortgageAvailable = l.mortgageAvailable, amenities = l.amenities.toSet(),
                maxGuests = s(l.maxGuests), minNights = s(l.minNights), checkInTime = l.checkInTime ?: "14:00",
                checkOutTime = l.checkOutTime ?: "12:00", houseRules = l.houseRules ?: "",
                photos = l.sortedImages.map { DraftPhoto(key = it.id, uploadId = it.uploadId ?: it.id, url = it.thumbUrl.ifBlank { it.url }, progress = 1f) },
                price = l.price.toString(), currency = l.currency, title = l.title, description = l.description,
                contactName = l.contactName,
                contactPhone = Phone.toLocalDigits(l.contactPhone ?: fallbackPhone),
            )
        }
    }
}

/** Reordering helpers for the photo strip (first photo = cover). */
object PhotoOrder {
    fun move(list: List<DraftPhoto>, from: Int, to: Int): List<DraftPhoto> {
        if (from !in list.indices || to !in list.indices || from == to) return list
        val m = list.toMutableList()
        val item = m.removeAt(from)
        m.add(to, item)
        return m
    }

    fun makeCover(list: List<DraftPhoto>, index: Int): List<DraftPhoto> = move(list, index, 0)
}
