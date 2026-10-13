package az.evtap.core.locations

import az.evtap.core.model.AppLocale
import az.evtap.core.model.CountryCode
import az.evtap.core.model.MetroLine
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Reference data from packages/shared/src/locations.ts, bundled as `assets/locations.json`
 * (regenerate with `node --experimental-strip-types tools/export-locations.mjs`).
 */
@Serializable
data class LocalizedName(val az: String, val en: String = az, val ru: String = az) {
    fun get(locale: AppLocale): String = when (locale) {
        AppLocale.AZ -> az
        AppLocale.RU -> ru
        AppLocale.EN -> en
    }
}

@Serializable data class Country(val code: CountryCode, val name: LocalizedName, val currency: String, val phonePrefix: String)

@Serializable
data class City(val id: String, val country: CountryCode, val name: LocalizedName, val lat: Double, val lng: Double, val popular: Boolean = false)

@Serializable data class District(val id: String, val cityId: String, val name: LocalizedName)

@Serializable
data class MetroStation(val id: String, val cityId: String, val line: MetroLine, val name: LocalizedName, val lat: Double, val lng: Double)

@Serializable
data class Locations(
    val countries: List<Country> = emptyList(),
    val cities: List<City> = emptyList(),
    val districts: List<District> = emptyList(),
    val metroStations: List<MetroStation> = emptyList(),
) {
    private val cityIndex by lazy { cities.associateBy { it.id } }
    private val districtIndex by lazy { districts.associateBy { it.id } }
    private val metroIndex by lazy { metroStations.associateBy { it.id } }

    fun city(id: String?): City? = id?.let { cityIndex[it] }
    fun district(id: String?): District? = id?.let { districtIndex[it] }
    fun metro(id: String?): MetroStation? = id?.let { metroIndex[it] }
    fun districtsOf(cityId: String?): List<District> = districts.filter { it.cityId == cityId }
    fun metrosOf(cityId: String?): List<MetroStation> = metroStations.filter { it.cityId == cityId }
    val popularCities: List<City> get() = cities.filter { it.popular }

    /** "Nəsimi r., Bakı" / "m. 28 May, Bakı" — the short location line used on cards. */
    fun label(cityId: String?, districtId: String?, metroId: String?, locale: AppLocale): String =
        listOfNotNull(district(districtId)?.name?.get(locale), metro(metroId)?.name?.get(locale), city(cityId)?.name?.get(locale))
            .distinct()
            .joinToString(", ")

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        fun parse(text: String): Locations = json.decodeFromString(serializer(), text)
    }
}
