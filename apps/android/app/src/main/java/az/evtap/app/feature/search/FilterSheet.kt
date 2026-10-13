package az.evtap.app.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.components.ChoiceChip
import az.evtap.app.ui.components.EvBottomSheet
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.MonthView
import az.evtap.app.ui.components.OptionSheet
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.Segmented
import az.evtap.app.ui.components.SelectField
import az.evtap.app.ui.components.Stepper
import az.evtap.app.ui.components.SwitchRow
import az.evtap.app.ui.components.WeekdayHeader
import az.evtap.app.ui.components.monthsFrom
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.booking.DateRange
import az.evtap.core.model.Amenity
import az.evtap.core.model.BuildingType
import az.evtap.core.model.CountryCode
import az.evtap.core.model.Currency
import az.evtap.core.model.DealType
import az.evtap.core.model.OwnerType
import az.evtap.core.model.PropertyType
import az.evtap.core.model.RepairType
import az.evtap.core.search.ListingFilters
import java.time.LocalDate

private enum class Picker { CITY, DISTRICT, METRO, DATES }

/** Full filter set of `listingSearchSchema` (except q / sort / bbox, which live in the search bar). */
@Composable
fun FilterSheet(initial: ListingFilters, onDismiss: () -> Unit, onApply: (ListingFilters) -> Unit) {
    var f by remember { mutableStateOf(initial) }
    var picker by remember { mutableStateOf<Picker?>(null) }
    val container = LocalAppContainer.current
    val locale = LocalAppLocale.current
    val loc = container.locations
    val any = stringResource(R.string.common_any)
    val all = stringResource(R.string.common_all)

    EvBottomSheet(
        onDismiss = onDismiss,
        title = stringResource(R.string.common_filters),
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.common_reset), { f = ListingFilters(dealType = f.dealType, sort = f.sort) }, Modifier.weight(1f), kind = PillKind.Secondary)
                PillButton(stringResource(R.string.search_show_results), { onApply(f); onDismiss() }, Modifier.weight(2f))
            }
        },
    ) {
        Label(stringResource(R.string.search_deal_type))
        Segmented(
            listOf<Pair<DealType?, String>>(null to all) + DealType.entries.map { it to stringResource(Labels.dealShort(it)) },
            f.dealType,
            { f = f.copy(dealType = it) },
        )

        Label(stringResource(R.string.search_property_type))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PropertyType.entries.forEach { p ->
                ChoiceChip(stringResource(Labels.property(p)), p in f.propertyType, {
                    f = f.copy(propertyType = if (p in f.propertyType) f.propertyType - p else f.propertyType + p)
                }, onCanvas = false)
            }
        }

        if (f.propertyType.isEmpty() || PropertyType.APARTMENT in f.propertyType) {
            Label(stringResource(R.string.search_building_type))
            Segmented(
                listOf<Pair<BuildingType?, String>>(null to any) + BuildingType.entries.map { it to stringResource(Labels.building(it)) },
                f.buildingType,
                { f = f.copy(buildingType = it) },
            )
        }

        Label(stringResource(R.string.search_country))
        Segmented(
            listOf<Pair<CountryCode?, String>>(null to all) + loc.countries.map { it.code to it.name.get(locale) },
            f.country,
            { code -> f = f.copy(country = code, cityId = f.cityId?.takeIf { loc.city(it)?.country == code || code == null }, districtId = emptySet(), metroId = emptySet()) },
        )
        SelectField(
            stringResource(R.string.search_city),
            loc.city(f.cityId)?.name?.get(locale),
            stringResource(R.string.search_any_city),
            { picker = Picker.CITY },
        )
        val districts = loc.districtsOf(f.cityId)
        if (districts.isNotEmpty()) {
            SelectField(
                stringResource(R.string.search_district),
                f.districtId.takeIf { it.isNotEmpty() }?.let { ids -> if (ids.size == 1) loc.district(ids.first())?.name?.get(locale) else stringResource(R.string.search_selected, ids.size) },
                any,
                { picker = Picker.DISTRICT },
            )
        }
        val metros = loc.metrosOf(f.cityId)
        if (metros.isNotEmpty()) {
            SelectField(
                stringResource(R.string.search_metro),
                f.metroId.takeIf { it.isNotEmpty() }?.let { ids -> if (ids.size == 1) loc.metro(ids.first())?.name?.get(locale) else stringResource(R.string.search_selected, ids.size) },
                any,
                { picker = Picker.METRO },
            )
        }

        Label(stringResource(R.string.search_price))
        RangeInputs(f.priceMin?.toString().orEmpty(), f.priceMax?.toString().orEmpty(), integer = true) { min, max ->
            f = f.copy(priceMin = min?.toLong(), priceMax = max?.toLong())
        }
        Segmented(
            listOf<Pair<Currency?, String>>(null to any) + Currency.entries.map { it to "${it.symbol} ${it.name}" },
            f.currency,
            { f = f.copy(currency = it) },
        )

        Label(stringResource(R.string.search_area))
        RangeInputs(f.areaMin?.let { az.evtap.core.format.Format.area(it) }.orEmpty(), f.areaMax?.let { az.evtap.core.format.Format.area(it) }.orEmpty(), integer = false) { min, max ->
            f = f.copy(areaMin = min, areaMax = max)
        }

        Label(stringResource(R.string.search_rooms))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..5).forEach { r ->
                ChoiceChip(if (r == 5) "5+" else r.toString(), r in f.rooms, {
                    f = f.copy(rooms = if (r in f.rooms) f.rooms - r else f.rooms + r)
                }, onCanvas = false)
            }
        }

        Label(stringResource(R.string.search_floor))
        RangeInputs(f.floorMin?.toString().orEmpty(), f.floorMax?.toString().orEmpty(), integer = true) { min, max ->
            f = f.copy(floorMin = min?.toInt(), floorMax = max?.toInt())
        }
        SwitchRow(stringResource(R.string.search_not_first_floor), f.notFirstFloor, { f = f.copy(notFirstFloor = it) })
        SwitchRow(stringResource(R.string.search_not_last_floor), f.notLastFloor, { f = f.copy(notLastFloor = it) })

        Label(stringResource(R.string.search_repair))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RepairType.entries.forEach { r ->
                ChoiceChip(stringResource(Labels.repair(r)), r in f.repair, {
                    f = f.copy(repair = if (r in f.repair) f.repair - r else f.repair + r)
                }, onCanvas = false)
            }
        }

        SwitchRow(stringResource(R.string.search_has_document), f.hasDocument, { f = f.copy(hasDocument = it) })
        SwitchRow(stringResource(R.string.search_mortgage), f.mortgageAvailable, { f = f.copy(mortgageAvailable = it) })
        SwitchRow(stringResource(R.string.search_with_photos), f.hasPhotos, { f = f.copy(hasPhotos = it) })
        SwitchRow(stringResource(R.string.search_verified_only), f.verified, { f = f.copy(verified = it) })

        Label(stringResource(R.string.search_owner_type))
        Segmented(
            listOf<Pair<OwnerType?, String>>(null to any) + OwnerType.entries.map { it to stringResource(Labels.owner(it)) },
            f.ownerType,
            { f = f.copy(ownerType = it) },
        )

        if (f.dealType == DealType.RENT_DAILY || f.dealType == null) {
            Label(stringResource(R.string.search_dates))
            val datesText = if (f.checkIn != null && f.checkOut != null) "${Dates.date(f.checkIn)} → ${Dates.date(f.checkOut)}" else null
            SelectField(stringResource(R.string.search_dates), datesText, stringResource(R.string.booking_select_dates), { picker = Picker.DATES })
            Stepper(f.guests ?: 0, { f = f.copy(guests = it.takeIf { g -> g > 0 }) }, stringResource(R.string.search_guests), min = 0, max = 50, valueText = f.guests?.toString() ?: any)
        }

        Label(stringResource(R.string.search_amenities))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Amenity.entries.forEach { a ->
                ChoiceChip(stringResource(Labels.amenity(a)), a in f.amenities, {
                    f = f.copy(amenities = if (a in f.amenities) f.amenities - a else f.amenities + a)
                }, onCanvas = false)
            }
        }
    }

    when (picker) {
        Picker.CITY -> OptionSheet(
            title = stringResource(R.string.search_city),
            options = loc.cities.filter { f.country == null || it.country == f.country }.map { it.id to it.name.get(locale) },
            selected = setOfNotNull(f.cityId),
            multiple = false,
            onDismiss = { picker = null },
            onSelect = { ids -> f = f.copy(cityId = ids.firstOrNull(), districtId = emptySet(), metroId = emptySet()) },
            clearLabel = stringResource(R.string.search_any_city),
        )
        Picker.DISTRICT -> OptionSheet(
            title = stringResource(R.string.search_district),
            options = loc.districtsOf(f.cityId).map { it.id to it.name.get(locale) },
            selected = f.districtId,
            multiple = true,
            onDismiss = { picker = null },
            onSelect = { f = f.copy(districtId = it) },
        )
        Picker.METRO -> OptionSheet(
            title = stringResource(R.string.search_metro),
            options = loc.metrosOf(f.cityId).map { it.id to it.name.get(locale) },
            selected = f.metroId,
            multiple = true,
            onDismiss = { picker = null },
            onSelect = { f = f.copy(metroId = it) },
        )
        Picker.DATES -> DateRangeSheet(
            initial = DateRange(f.checkIn?.let(LocalDate::parse), f.checkOut?.let(LocalDate::parse)),
            onDismiss = { picker = null },
            onApply = { r -> f = f.copy(checkIn = r.checkIn?.toString(), checkOut = r.checkOut?.toString()) },
        )
        null -> Unit
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = EvTheme.type.bodyStrong, modifier = Modifier.semantics { heading() })
}

@Composable
private fun RangeInputs(min: String, max: String, integer: Boolean, onChange: (Double?, Double?) -> Unit) {
    var a by remember(min) { mutableStateOf(min) }
    var b by remember(max) { mutableStateOf(max) }
    fun parse(s: String) = s.replace(',', '.').filter { it.isDigit() || it == '.' }.toDoubleOrNull()
    val kb = KeyboardOptions(keyboardType = if (integer) KeyboardType.Number else KeyboardType.Decimal)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        EvTextField(a, { a = it; onChange(parse(it), parse(b)) }, null, Modifier.weight(1f), placeholder = stringResource(R.string.common_from), keyboardOptions = kb)
        EvTextField(b, { b = it; onChange(parse(a), parse(it)) }, null, Modifier.weight(1f), placeholder = stringResource(R.string.common_to), keyboardOptions = kb)
    }
}

/** Check-in / check-out picker without availability (search filter). */
@Composable
fun DateRangeSheet(initial: DateRange, onDismiss: () -> Unit, onApply: (DateRange) -> Unit) {
    var range by remember { mutableStateOf(initial) }
    val today = remember { LocalDate.now() }
    EvBottomSheet(
        onDismiss = onDismiss,
        title = stringResource(if (range.checkIn != null && range.checkOut == null) R.string.booking_select_check_out else R.string.booking_select_dates),
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.common_clear), { onApply(DateRange()); onDismiss() }, Modifier.weight(1f), kind = PillKind.Secondary)
                PillButton(stringResource(R.string.common_apply), { onApply(range); onDismiss() }, Modifier.weight(2f), enabled = range.complete)
            }
        },
    ) {
        WeekdayHeader()
        Column {
            monthsFrom(today, 12).forEach { m ->
                MonthView(m, { range.stateOf(it, today) }, { range = range.tap(it, today) })
            }
        }
    }
}
