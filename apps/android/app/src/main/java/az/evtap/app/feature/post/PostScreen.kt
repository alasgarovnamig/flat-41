package az.evtap.app.feature.post

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import az.evtap.app.R
import az.evtap.app.platform.ImageFiles
import az.evtap.app.platform.LocationProvider
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.fieldErrorText
import az.evtap.app.ui.components.ChoiceChip
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.ConfirmDialog
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvImage
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.OptionSheet
import az.evtap.app.ui.components.PhoneField
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.PinPickerMap
import az.evtap.app.ui.components.Segmented
import az.evtap.app.ui.components.SelectField
import az.evtap.app.ui.components.SpecChip
import az.evtap.app.ui.components.SwitchRow
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.ListingFeeRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.PromoteRoute
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.format.Phone
import az.evtap.core.listing.DraftPhoto
import az.evtap.core.listing.ListingDraft
import az.evtap.core.model.Amenity
import az.evtap.core.model.BuildingType
import az.evtap.core.model.Currency
import az.evtap.core.model.DealType
import az.evtap.core.model.PropertyType
import az.evtap.core.model.RepairType
import com.google.android.gms.maps.model.LatLng

private val STEP_TITLES = listOf(
    R.string.post_steps_type, R.string.post_steps_location, R.string.post_steps_details,
    R.string.post_steps_photos, R.string.post_steps_price, R.string.post_steps_review,
)

@Composable
fun PostScreen(editId: String?) {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel(key = "post-$editId") { PostViewModel(editId, it) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    var discardOpen by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()
    LaunchedEffect(ui.step) { scroll.scrollTo(0) }

    val close: () -> Unit = { if (vm.isEdit) navigator.back() else discardOpen = true }
    BackHandler { if (!vm.back()) close() }

    EvScreen(
        topBar = {
            Column {
                EvTopBar(stringResource(if (vm.isEdit) R.string.post_edit_title else R.string.post_title), onBack = null, actions = {
                    IconCircleButton(EvIcons.Close, stringResource(R.string.common_close), close, style = CircleStyle.Raised)
                })
                Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.post_step, ui.step + 1, PostUiState.STEPS), style = EvTheme.type.label, color = EvTheme.colors.muted)
                        Spacer(Modifier.size(8.dp))
                        Text(stringResource(STEP_TITLES[ui.step]), style = EvTheme.type.bodyStrong, modifier = Modifier.semantics { heading() })
                    }
                    LinearProgressIndicator(
                        progress = { (ui.step + 1f) / PostUiState.STEPS },
                        modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(50)),
                        color = EvTheme.colors.ink,
                        trackColor = EvTheme.colors.pill,
                        strokeCap = StrokeCap.Round,
                        drawStopIndicator = {},
                    )
                }
            }
        },
        bottomBar = {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (ui.step > 0 && !(vm.isEdit && ui.step == 5)) {
                    PillButton(stringResource(R.string.common_back), { vm.back() }, Modifier.weight(1f), kind = PillKind.Secondary)
                }
                if (!ui.isLastStep) {
                    PillButton(
                        stringResource(R.string.common_next),
                        { vm.next() },
                        Modifier.weight(2f),
                        enabled = !(ui.step == 3 && ui.draft.uploading),
                        loading = ui.step == 3 && ui.draft.uploading,
                        trailingIcon = EvIcons.ChevronRight,
                    )
                } else {
                    PillButton(
                        stringResource(if (vm.isEdit) R.string.post_save_changes else R.string.post_submit),
                        {
                            vm.submit { res ->
                                when (res) {
                                    is PostResult.Updated -> {
                                        container.toaster.success(R.string.post_updated)
                                        navigator.back()
                                    }
                                    is PostResult.Created -> {
                                        container.toaster.success(R.string.post_submitted)
                                        if (res.listing.requiresPayment) navigator.replace(ListingFeeRoute(res.listing.id))
                                        else navigator.replace(PromoteRoute(res.listing.id, upsell = true))
                                    }
                                }
                            }
                        },
                        Modifier.weight(2f),
                        loading = ui.submitting,
                        enabled = !ui.draft.uploading,
                    )
                }
            }
        },
    ) { padding ->
        when {
            ui.loading -> LoadingBox(Modifier.padding(padding))
            ui.loadError != null -> ErrorState(ui.loadError!!, vm::loadExisting, Modifier.padding(padding))
            else -> Column(
                Modifier.fillMaxSize().verticalScroll(scroll).padding(padding).padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                when (ui.step) {
                    0 -> TypeStep(ui, vm)
                    1 -> LocationStep(ui, vm)
                    2 -> DetailsStep(ui, vm)
                    3 -> PhotosStep(ui, vm)
                    4 -> PriceStep(ui, vm)
                    else -> ReviewStep(ui, vm)
                }
            }
        }
    }

    if (discardOpen) {
        ConfirmDialog(
            title = stringResource(R.string.post_discard_title),
            text = stringResource(R.string.post_discard_text),
            confirmLabel = stringResource(R.string.post_discard),
            destructive = true,
            onConfirm = { navigator.back() },
            onDismiss = { discardOpen = false },
        )
    }
}

@Composable
private fun err(ui: PostUiState, key: String): String? = fieldErrorText(ui.errors[key])

@Composable
private fun StepLabel(text: String) = Text(text, style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })

// ───────────────────────────── 1. Type ─────────────────────────────

@Composable
private fun TypeStep(ui: PostUiState, vm: PostViewModel) {
    val d = ui.draft
    StepLabel(stringResource(R.string.post_choose_deal))
    DealType.entries.forEach { t ->
        OptionCard(
            icon = when (t) { DealType.SALE -> EvIcons.Tag; DealType.RENT_LONG -> EvIcons.Key; DealType.RENT_DAILY -> EvIcons.CalendarDays },
            title = stringResource(Labels.deal(t)),
            subtitle = if (t == DealType.RENT_DAILY) stringResource(R.string.post_daily_free) else null,
            selected = d.dealType == t,
            onClick = { vm.edit { it.copy(dealType = t) } },
        )
    }
    err(ui, "dealType")?.let { ErrorText(it) }
    StepLabel(stringResource(R.string.post_choose_property))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PropertyType.entries.forEach { p ->
            ChoiceChip(stringResource(Labels.property(p)), d.propertyType == p, { vm.edit { it.copy(propertyType = p) } })
        }
    }
    err(ui, "propertyType")?.let { ErrorText(it) }
    if (d.propertyType == PropertyType.APARTMENT) {
        Text(stringResource(R.string.search_building_type), style = EvTheme.type.bodyStrong)
        Segmented(BuildingType.entries.map { it to stringResource(Labels.building(it)) }, d.buildingType ?: BuildingType.SECONDARY, { b ->
            vm.edit { it.copy(buildingType = b) }
        })
    }
}

@Composable
private fun OptionCard(icon: ImageVector, title: String, subtitle: String?, selected: Boolean, onClick: () -> Unit) {
    val c = EvTheme.colors
    val shape = RoundedCornerShape(EvRadius.lg)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(shape)
            .background(if (selected) c.ink else c.surfaceRaised)
            .border(BorderStroke(1.dp, if (selected) c.ink else c.hairline), shape)
            .pressable(onClick, role = Role.RadioButton)
            .semantics { this.selected = selected }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(if (selected) c.onInk.copy(alpha = 0.12f) else c.surfaceSunken), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (selected) c.onInk else c.ink, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = EvTheme.type.bodyStrong, color = if (selected) c.onInk else c.ink)
            if (subtitle != null) Text(subtitle, style = EvTheme.type.caption, color = if (selected) c.onInk.copy(alpha = 0.7f) else c.muted)
        }
        if (selected) Icon(EvIcons.CheckCircle, null, tint = c.onInk)
    }
}

@Composable
private fun ErrorText(text: String) = Text(text, style = EvTheme.type.caption, color = EvTheme.colors.danger)

// ───────────────────────────── 2. Location ─────────────────────────────

private enum class LocPicker { CITY, DISTRICT, METRO }

@Composable
private fun LocationStep(ui: PostUiState, vm: PostViewModel) {
    val d = ui.draft
    val loc = LocalAppContainer.current.locations
    val locale = LocalAppLocale.current
    val context = LocalContext.current
    var picker by remember { mutableStateOf<LocPicker?>(null) }
    var hasLocation by remember { mutableStateOf(LocationProvider.hasPermission(context)) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        hasLocation = result.values.any { it }
        if (hasLocation) vm.useMyLocation() else LocalToaster.show(context)
    }

    SelectField(stringResource(R.string.search_city), loc.city(d.cityId)?.name?.get(locale), stringResource(R.string.common_select), { picker = LocPicker.CITY }, error = err(ui, "cityId"))
    if (loc.districtsOf(d.cityId).isNotEmpty()) {
        SelectField(stringResource(R.string.search_district), loc.district(d.districtId)?.name?.get(locale), stringResource(R.string.common_optional), { picker = LocPicker.DISTRICT })
    }
    if (loc.metrosOf(d.cityId).isNotEmpty()) {
        SelectField(stringResource(R.string.search_metro), loc.metro(d.metroId)?.name?.get(locale), stringResource(R.string.common_optional), { picker = LocPicker.METRO })
    }
    EvTextField(d.address, { v -> vm.edit { it.copy(address = v) } }, stringResource(R.string.post_address), maxLength = 200, error = err(ui, "address"))

    StepLabel(stringResource(R.string.post_pin_on_map))
    Text(stringResource(R.string.post_tap_to_pin), style = EvTheme.type.caption, color = EvTheme.colors.muted)
    val city = loc.city(d.cityId)
    val center = remember(city?.id) { LatLng(city?.lat ?: 40.4093, city?.lng ?: 49.8671) }
    val pin = d.lat?.let { lat -> d.lng?.let { LatLng(lat, it) } }
    Box(Modifier.fillMaxWidth().height(280.dp).clip(RoundedCornerShape(EvRadius.lg))) {
        PinPickerMap(pin, center, { vm.setPin(it.latitude, it.longitude) }, Modifier.fillMaxSize(), myLocationEnabled = hasLocation)
    }
    PillButton(
        stringResource(R.string.post_use_my_location),
        { if (hasLocation) vm.useMyLocation() else permission.launch(LocationProvider.PERMISSIONS) },
        Modifier.fillMaxWidth(),
        kind = PillKind.Secondary,
        icon = EvIcons.Locate,
        loading = ui.locating,
    )

    when (picker) {
        LocPicker.CITY -> OptionSheet(stringResource(R.string.search_city), loc.cities.map { it.id to it.name.get(locale) }, setOfNotNull(d.cityId), false, { picker = null }, { ids ->
            vm.edit { it.copy(cityId = ids.firstOrNull(), districtId = null, metroId = null, lat = null, lng = null) }
        })
        LocPicker.DISTRICT -> OptionSheet(stringResource(R.string.search_district), loc.districtsOf(d.cityId).map { it.id to it.name.get(locale) }, setOfNotNull(d.districtId), false, { picker = null }, { ids ->
            vm.edit { it.copy(districtId = ids.firstOrNull()) }
        }, clearLabel = stringResource(R.string.common_any))
        LocPicker.METRO -> OptionSheet(stringResource(R.string.search_metro), loc.metrosOf(d.cityId).map { it.id to it.name.get(locale) }, setOfNotNull(d.metroId), false, { picker = null }, { ids ->
            vm.edit { it.copy(metroId = ids.firstOrNull()) }
        }, clearLabel = stringResource(R.string.common_any))
        null -> Unit
    }
}

/** Shows "permission denied" through the app toaster from a non-composable callback. */
private object LocalToaster {
    fun show(context: android.content.Context) {
        (context.applicationContext as? az.evtap.app.EvTapApp)?.container?.toaster?.info(R.string.post_location_denied)
    }
}

// ───────────────────────────── 3. Details ─────────────────────────────

@Composable
private fun NumberField(ui: PostUiState, key: String, value: String, label: String, decimal: Boolean = false, suffix: String? = null, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    EvTextField(
        value,
        { v -> onChange(v.filter { it.isDigit() || (decimal && (it == '.' || it == ',')) || (key == "floor" && it == '-') }.take(10)) },
        label,
        modifier,
        error = err(ui, key),
        suffix = suffix,
        keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
    )
}

@Composable
private fun DetailsStep(ui: PostUiState, vm: PostViewModel) {
    val d = ui.draft
    val m2 = stringResource(R.string.common_m2)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        NumberField(ui, "area", d.area, stringResource(R.string.listing_area), decimal = true, suffix = m2, onChange = { v -> vm.edit { it.copy(area = v) } }, modifier = Modifier.weight(1f))
        if (d.hasLand) NumberField(ui, "landArea", d.landArea, stringResource(R.string.listing_land_area), decimal = true, suffix = stringResource(R.string.common_sot), onChange = { v -> vm.edit { it.copy(landArea = v) } }, modifier = Modifier.weight(1f))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        NumberField(ui, "rooms", d.rooms, stringResource(R.string.listing_rooms), onChange = { v -> vm.edit { it.copy(rooms = v) } }, modifier = Modifier.weight(1f))
        NumberField(ui, "bathrooms", d.bathrooms, stringResource(R.string.listing_bathrooms), onChange = { v -> vm.edit { it.copy(bathrooms = v) } }, modifier = Modifier.weight(1f))
    }
    if (d.hasFloors) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NumberField(ui, "floor", d.floor, stringResource(R.string.listing_floor), onChange = { v -> vm.edit { it.copy(floor = v) } }, modifier = Modifier.weight(1f))
            NumberField(ui, "totalFloors", d.totalFloors, stringResource(R.string.listing_total_floors), onChange = { v -> vm.edit { it.copy(totalFloors = v) } }, modifier = Modifier.weight(1f))
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        NumberField(ui, "yearBuilt", d.yearBuilt, stringResource(R.string.listing_year_built), onChange = { v -> vm.edit { it.copy(yearBuilt = v) } }, modifier = Modifier.weight(1f))
        NumberField(ui, "ceilingHeight", d.ceilingHeight, stringResource(R.string.listing_ceiling_height), decimal = true, suffix = "m", onChange = { v -> vm.edit { it.copy(ceilingHeight = v) } }, modifier = Modifier.weight(1f))
    }
    Text(stringResource(R.string.listing_repair), style = EvTheme.type.bodyStrong)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RepairType.entries.forEach { r -> ChoiceChip(stringResource(Labels.repair(r)), d.repair == r, { vm.edit { it.copy(repair = if (it.repair == r) null else r) } }) }
    }
    if (d.dealType == DealType.SALE) {
        SwitchRow(stringResource(R.string.search_has_document), d.hasDocument, { v -> vm.edit { it.copy(hasDocument = v) } })
        SwitchRow(stringResource(R.string.search_mortgage), d.mortgageAvailable, { v -> vm.edit { it.copy(mortgageAvailable = v) } })
    }
    if (d.isDaily) {
        StepLabel(stringResource(R.string.post_daily))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NumberField(ui, "maxGuests", d.maxGuests, stringResource(R.string.listing_max_guests), onChange = { v -> vm.edit { it.copy(maxGuests = v) } }, modifier = Modifier.weight(1f))
            NumberField(ui, "minNights", d.minNights, stringResource(R.string.listing_min_nights), onChange = { v -> vm.edit { it.copy(minNights = v) } }, modifier = Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            EvTextField(d.checkInTime, { v -> vm.edit { it.copy(checkInTime = v.take(5)) } }, stringResource(R.string.listing_check_in_time), Modifier.weight(1f), placeholder = "14:00", error = err(ui, "checkInTime"),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            EvTextField(d.checkOutTime, { v -> vm.edit { it.copy(checkOutTime = v.take(5)) } }, stringResource(R.string.listing_check_out_time), Modifier.weight(1f), placeholder = "12:00", error = err(ui, "checkOutTime"),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        EvTextField(d.houseRules, { v -> vm.edit { it.copy(houseRules = v) } }, stringResource(R.string.listing_house_rules), singleLine = false, minLines = 3, maxLength = 2000, error = err(ui, "houseRules"))
    }
    Text(stringResource(R.string.listing_amenities), style = EvTheme.type.bodyStrong)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Amenity.entries.forEach { a ->
            ChoiceChip(stringResource(Labels.amenity(a)), a in d.amenities, { vm.edit { it.copy(amenities = if (a in it.amenities) it.amenities - a else it.amenities + a) } })
        }
    }
}

// ───────────────────────────── 4. Photos ─────────────────────────────

@Composable
private fun PhotosStep(ui: PostUiState, vm: PostViewModel) {
    val context = LocalContext.current
    val d = ui.draft
    var captureUri by rememberSaveable { mutableStateOf<String?>(null) }
    val room = ListingDraft.MAX_PHOTOS - d.photos.size
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(ListingDraft.MAX_PHOTOS)) { uris: List<Uri> ->
        if (uris.isNotEmpty()) vm.addPhotos(uris)
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = captureUri
        if (ok && uri != null) vm.addPhotos(listOf(Uri.parse(uri)))
    }
    Text(stringResource(R.string.post_photos_hint), style = EvTheme.type.caption, color = EvTheme.colors.muted)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PillButton(stringResource(R.string.post_gallery), {
            gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }, Modifier.weight(1f), kind = PillKind.Primary, icon = EvIcons.ImagePlus, enabled = room > 0)
        PillButton(stringResource(R.string.post_camera), {
            val uri = ImageFiles.newCaptureUri(context)
            captureUri = uri.toString()
            camera.launch(uri)
        }, Modifier.weight(1f), kind = PillKind.Secondary, icon = EvIcons.Camera, enabled = room > 0)
    }
    err(ui, "imageIds")?.let { ErrorText(it) }
    d.photos.chunked(2).forEachIndexed { row, pair ->
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            pair.forEachIndexed { col, p ->
                PhotoTile(
                    p,
                    index = row * 2 + col,
                    count = d.photos.size,
                    modifier = Modifier.weight(1f),
                    onMove = { from, to -> vm.movePhoto(from, to) },
                    onCover = vm::makeCover,
                    onRemove = { vm.removePhoto(p.key) },
                    onRetry = { vm.retryPhoto(p.key) },
                )
            }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun PhotoTile(
    p: DraftPhoto,
    index: Int,
    count: Int,
    modifier: Modifier,
    onMove: (Int, Int) -> Unit,
    onCover: (Int) -> Unit,
    onRemove: () -> Unit,
    onRetry: () -> Unit,
) {
    val c = EvTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(EvRadius.md))) {
            EvImage(p.url ?: p.localUri, null, Modifier.fillMaxSize())
            if (!p.uploaded) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                    if (p.failed) {
                        PillButton(stringResource(R.string.common_retry), onRetry, size = PillSize.Small, kind = PillKind.Accent, icon = EvIcons.RotateCcw)
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(progress = { p.progress }, color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                            Text(stringResource(R.string.post_uploading, (p.progress * 100).toInt()), style = EvTheme.type.micro, color = Color.White)
                        }
                    }
                }
            }
            if (index == 0) Tag(stringResource(R.string.post_cover), Modifier.align(Alignment.TopStart).padding(8.dp), background = c.ink, content = c.onInk)
            IconCircleButton(EvIcons.Trash, stringResource(R.string.common_delete), onRemove, Modifier.align(Alignment.TopEnd), style = CircleStyle.Glass, size = 32.dp, iconSize = 16.dp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconCircleButton(EvIcons.ChevronLeft, stringResource(R.string.post_move_left), { onMove(index, index - 1) }, size = 32.dp, iconSize = 16.dp, enabled = index > 0)
            IconCircleButton(EvIcons.ChevronRight, stringResource(R.string.post_move_right), { onMove(index, index + 1) }, size = 32.dp, iconSize = 16.dp, enabled = index < count - 1)
            Spacer(Modifier.weight(1f))
            if (index > 0) PillButton(stringResource(R.string.post_make_cover), { onCover(index) }, kind = PillKind.Ghost, size = PillSize.Small)
        }
    }
}

// ───────────────────────────── 5. Price & contact ─────────────────────────────

@Composable
private fun PriceStep(ui: PostUiState, vm: PostViewModel) {
    val d = ui.draft
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        NumberField(ui, "price", d.price, stringResource(R.string.post_price), onChange = { v -> vm.edit { it.copy(price = v) } }, modifier = Modifier.weight(1f),
            suffix = d.currency.symbol)
    }
    Segmented(Currency.entries.map { it to "${it.symbol} ${it.name}" }, d.currency, { cur -> vm.edit { it.copy(currency = cur) } })
    EvTextField(d.title, { v -> vm.edit { it.copy(title = v) } }, stringResource(R.string.post_title_field), placeholder = stringResource(R.string.post_title_hint), maxLength = 120, error = err(ui, "title"))
    EvTextField(d.description, { v -> vm.edit { it.copy(description = v) } }, stringResource(R.string.post_description_field), placeholder = stringResource(R.string.post_description_hint),
        singleLine = false, minLines = 6, maxLength = 5000, error = err(ui, "description"))
    EvTextField(d.contactName, { v -> vm.edit { it.copy(contactName = v) } }, stringResource(R.string.post_contact_name), maxLength = 80, error = err(ui, "contactName"))
    PhoneField(d.contactPhone, { v -> vm.edit { it.copy(contactPhone = v) } }, stringResource(R.string.post_contact_phone), error = err(ui, "contactPhone"))
}

// ───────────────────────────── 6. Review ─────────────────────────────

@Composable
private fun ReviewStep(ui: PostUiState, vm: PostViewModel) {
    val d = ui.draft
    val container = LocalAppContainer.current
    val locale = LocalAppLocale.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val quota = (session as? az.evtap.app.data.SessionState.Authed)?.me?.quota
    val c = EvTheme.colors

    StepLabel(stringResource(R.string.post_review))
    if (!vm.isEdit) {
        val notice = when {
            d.isDaily -> stringResource(R.string.post_daily_free)
            quota == null -> null
            quota.unlimited -> stringResource(R.string.post_quota_unlimited)
            quota.remaining > 0 -> stringResource(R.string.post_quota_free, quota.remaining)
            else -> stringResource(R.string.post_quota_paid, Format.money(quota.listingFee))
        }
        notice?.let { NoticeBanner(it, tone = if (quota != null && quota.remaining == 0 && !quota.unlimited && !d.isDaily) NoticeTone.Warning else NoticeTone.Info) }
    }
    EvCard(Modifier.fillMaxWidth(), color = c.surfaceRaised) {
        d.photos.firstOrNull()?.let { p ->
            EvImage(p.url ?: p.localUri, null, Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(RoundedCornerShape(EvRadius.md)))
            Spacer(Modifier.height(12.dp))
        }
        Text(d.title.ifBlank { "—" }, style = EvTheme.type.h3, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            listOfNotNull(
                d.dealType?.let { stringResource(Labels.deal(it)) },
                d.propertyType?.let { stringResource(Labels.property(it)) },
                container.locations.label(d.cityId, d.districtId, d.metroId, locale).takeIf { it.isNotBlank() },
            ).joinToString(" · "),
            style = EvTheme.type.caption,
            color = c.muted,
        )
        Spacer(Modifier.height(8.dp))
        Text("${d.currency.symbol} ${d.price.toLongOrNull()?.let { Format.groupThousands(it) } ?: "—"}", style = EvTheme.type.number)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (d.area.isNotBlank()) SpecChip("${d.area} ${stringResource(R.string.common_m2)}", icon = EvIcons.Ruler)
            if (d.rooms.isNotBlank()) SpecChip(stringResource(R.string.common_rooms_short, d.rooms), icon = EvIcons.Bed)
            if (d.floor.isNotBlank()) SpecChip(if (d.totalFloors.isNotBlank()) stringResource(R.string.common_floor_of, d.floor, d.totalFloors) else d.floor, icon = EvIcons.Layers)
            SpecChip(stringResource(R.string.common_photos, d.photos.count { it.uploaded }), icon = EvIcons.Image)
        }
        Spacer(Modifier.height(8.dp))
        Text("${d.contactName} · ${Format.phone(Phone.fromLocalDigits(d.contactPhone))}", style = EvTheme.type.caption, color = c.inkSecondary)
    }
    // jump back to any step
    STEP_TITLES.dropLast(1).forEachIndexed { i, title ->
        val stepHasError = ListingDraft.errorsForStep(ui.errors, i).isNotEmpty()
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(EvRadius.md)).background(c.surfaceRaised).pressable({ vm.goTo(i) }).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${i + 1}. ${stringResource(title)}", style = EvTheme.type.body, modifier = Modifier.weight(1f), color = if (stepHasError) c.danger else c.ink)
            Icon(if (stepHasError) EvIcons.AlertCircle else EvIcons.Pencil, null, tint = if (stepHasError) c.danger else c.inkSecondary, modifier = Modifier.size(18.dp))
        }
    }
}
