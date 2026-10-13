package az.evtap.app.feature.listing

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvBottomSheet
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvImage
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.MoneyText
import az.evtap.app.ui.components.OptionSheet
import az.evtap.app.ui.components.PhoneField
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.RadioRow
import az.evtap.app.ui.components.SelectField
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.format.Phone
import az.evtap.core.model.ListingDetail
import az.evtap.core.model.MortgageBank
import az.evtap.core.model.ReportReason
import az.evtap.core.model.Review
import az.evtap.core.model.ReviewReplyInput
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlin.math.roundToLong

// ───────────────────────────── Report ─────────────────────────────

@Composable
fun ReportSheet(vm: ListingViewModel, onDismiss: () -> Unit) {
    var reason by rememberSaveable { mutableStateOf<ReportReason?>(null) }
    var comment by rememberSaveable { mutableStateOf("") }
    val busy by vm.busy.collectAsStateWithLifecycle()
    EvBottomSheet(
        onDismiss = onDismiss,
        title = stringResource(R.string.report_title),
        footer = {
            PillButton(
                stringResource(R.string.common_send),
                { reason?.let { vm.report(it, comment, onDismiss) } },
                Modifier.fillMaxWidth(),
                enabled = reason != null,
                loading = busy,
            )
        },
    ) {
        Text(stringResource(R.string.report_reason), style = EvTheme.type.bodyStrong)
        ReportReason.entries.forEach { r -> RadioRow(stringResource(Labels.report(r)), reason == r, { reason = r }) }
        EvTextField(comment, { comment = it }, stringResource(R.string.report_comment) + " (" + stringResource(R.string.common_optional) + ")", singleLine = false, minLines = 3, maxLength = 1000)
    }
}

// ───────────────────────────── Mortgage ─────────────────────────────

/** Calculator inputs, shared by the card and the lead form. */
class MortgageState(initialRate: Float) {
    var downPct by mutableFloatStateOf(30f)
    var years by mutableIntStateOf(15)
    var rate by mutableFloatStateOf(initialRate)
    var bankCode by mutableStateOf<String?>(null)

    fun down(price: Long): Long = (price * downPct / 100f).roundToLong()
}

@Composable
fun rememberMortgageState(): MortgageState = remember { MortgageState(12f) }

/** Annuity calculator (shared formula from :core) with bank presets from GET /mortgage/banks. */
@Composable
fun MortgageCalculatorCard(price: Long, banks: List<MortgageBank>, state: MortgageState, onApply: () -> Unit) {
    val c = EvTheme.colors
    var bankPicker by remember { mutableStateOf(false) }
    LaunchedEffect(banks) {
        if (state.bankCode == null && banks.isNotEmpty()) {
            state.bankCode = banks.first().code
            state.rate = banks.first().annualRate.toFloat()
        }
    }
    val bank = banks.firstOrNull { it.code == state.bankCode }
    val maxYears = bank?.maxTermYears ?: 30
    val minDown = bank?.minDownPaymentPercent?.toFloat() ?: 0f
    LaunchedEffect(maxYears, minDown) {
        if (state.years > maxYears) state.years = maxYears
        if (state.downPct < minDown) state.downPct = minDown
    }
    val down = state.down(price)
    val monthly = Format.mortgageMonthly((price - down).toDouble(), state.rate.toDouble(), state.years)
    val sliderColors = SliderDefaults.colors(thumbColor = c.ink, activeTrackColor = c.ink, inactiveTrackColor = c.pill)

    EvCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.mortgage_title), style = EvTheme.type.h3, modifier = Modifier.weight(1f).semantics { heading() })
            androidx.compose.material3.Icon(EvIcons.Calculator, null, tint = c.inkSecondary)
        }
        Spacer(Modifier.height(10.dp))
        Text(stringResource(R.string.mortgage_monthly), style = EvTheme.type.label, color = c.muted)
        MoneyText((monthly * 100).roundToLong())
        Spacer(Modifier.height(12.dp))
        if (banks.isNotEmpty()) {
            SelectField(stringResource(R.string.mortgage_bank), bank?.let { "${it.name} · ${it.annualRate}%" }, stringResource(R.string.common_select), { bankPicker = true })
            Spacer(Modifier.height(10.dp))
        }
        LabeledSlider(stringResource(R.string.mortgage_down_payment), "${state.downPct.toInt()}% · ${Format.price(down, az.evtap.core.model.Currency.AZN)}") {
            Slider(state.downPct, { state.downPct = it.coerceAtLeast(minDown) }, valueRange = 0f..90f, colors = sliderColors)
        }
        LabeledSlider(stringResource(R.string.mortgage_term), "${state.years} ${stringResource(R.string.common_years_short)}") {
            Slider(state.years.toFloat(), { state.years = it.toInt().coerceIn(1, maxYears) }, valueRange = 1f..maxYears.toFloat(), colors = sliderColors)
        }
        LabeledSlider(stringResource(R.string.mortgage_rate), String.format(java.util.Locale.US, "%.1f%%", state.rate)) {
            Slider(state.rate, { state.rate = (it * 10).toInt() / 10f }, valueRange = 0f..25f, colors = sliderColors)
        }
        Spacer(Modifier.height(8.dp))
        PillButton(stringResource(R.string.mortgage_apply), onApply, Modifier.fillMaxWidth(), icon = EvIcons.Send)
    }
    if (bankPicker) {
        OptionSheet(
            title = stringResource(R.string.mortgage_bank),
            options = banks.map { it.code to "${it.name} · ${it.annualRate}%" },
            selected = setOfNotNull(state.bankCode),
            multiple = false,
            onDismiss = { bankPicker = false },
            onSelect = { sel ->
                state.bankCode = sel.firstOrNull()
                banks.firstOrNull { it.code == state.bankCode }?.let { state.rate = it.annualRate.toFloat() }
            },
        )
    }
}

@Composable
private fun LabeledSlider(label: String, value: String, slider: @Composable () -> Unit) {
    Column {
        Row {
            Text(label, style = EvTheme.type.label, color = EvTheme.colors.inkSecondary, modifier = Modifier.weight(1f))
            Text(value, style = EvTheme.type.label)
        }
        slider()
    }
}

@Composable
fun MortgageLeadSheet(vm: ListingViewModel, price: Long, mortgage: MortgageState, onDismiss: () -> Unit) {
    val me = LocalAppContainer.current.session.me
    var name by rememberSaveable { mutableStateOf(me?.name.orEmpty()) }
    var phone by rememberSaveable { mutableStateOf(Phone.toLocalDigits(me?.phone)) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val down = mortgage.down(price)
    EvBottomSheet(
        onDismiss = onDismiss,
        title = stringResource(R.string.mortgage_apply_title),
        footer = {
            PillButton(
                stringResource(R.string.common_send),
                { vm.mortgageLead(name, phone, price, down, mortgage.years, mortgage.bankCode, onDismiss) },
                Modifier.fillMaxWidth(),
                enabled = name.trim().length >= 2 && Phone.isCompleteLocal(phone),
                loading = busy,
            )
        },
    ) {
        EvTextField(name, { name = it }, stringResource(R.string.mortgage_name), maxLength = 80)
        PhoneField(phone, { phone = it }, stringResource(R.string.mortgage_phone))
        Text(
            "${stringResource(R.string.mortgage_price)}: ${Format.price(price, az.evtap.core.model.Currency.AZN)} · " +
                "${stringResource(R.string.mortgage_down_payment)}: ${Format.price(down, az.evtap.core.model.Currency.AZN)} · " +
                "${mortgage.years} ${stringResource(R.string.common_years_short)}",
            style = EvTheme.type.caption,
            color = EvTheme.colors.muted,
        )
    }
}

// ───────────────────────────── Fullscreen gallery ─────────────────────────────

class GalleryViewModel(id: String, c: AppContainer) : ViewModel() {
    val detail = MutableStateFlow<Load<ListingDetail>>(Load.Loading)
    init {
        loadInto(detail) { c.api.call { listing(id) } }
    }
}

/** Black full-screen pager with pinch-to-zoom (double-tap free); swipe left/right between photos. */
@Composable
fun GalleryScreen(id: String, index: Int) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "gallery-$id") { GalleryViewModel(id, it) }
    val load by vm.detail.collectAsStateWithLifecycle()
    val images = load.dataOrNull?.sortedImages.orEmpty()
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (images.isNotEmpty()) {
            val pager = rememberPagerState(initialPage = index.coerceIn(0, images.size - 1)) { images.size }
            HorizontalPager(pager, Modifier.fillMaxSize(), key = { images[it].id }) { page ->
                ZoomableImage(images[page].url, "${page + 1} / ${images.size}")
            }
            Tag(
                "${pager.currentPage + 1} / ${images.size}",
                Modifier.align(Alignment.BottomCenter).padding(bottom = 40.dp),
                background = Color.White.copy(alpha = 0.18f),
                content = Color.White,
            )
        } else if (load is Load.Loading) {
            LoadingBox()
        }
        IconCircleButton(
            EvIcons.Close,
            stringResource(R.string.common_close),
            navigator::back,
            Modifier.statusBarsPadding().padding(12.dp),
            style = CircleStyle.Glass,
        )
    }
}

@Composable
private fun ZoomableImage(url: String, description: String) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    EvImage(
        url,
        description,
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 4f)
                    if (scale > 1f) {
                        offsetX += pan.x
                        offsetY += pan.y
                    } else {
                        offsetX = 0f
                        offsetY = 0f
                    }
                }
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offsetX
                translationY = offsetY
            },
        contentScale = ContentScale.Fit,
    )
}

// ───────────────────────────── Reviews ─────────────────────────────

class ReviewsViewModel(private val listingId: String, private val c: AppContainer) : ViewModel() {
    val pager = Pager<Review>(viewModelScope) { page, size -> c.api.call { reviews(listingId, page, size) } }
    val listing = MutableStateFlow<Load<ListingDetail>>(Load.Loading)

    init {
        pager.refresh()
        loadInto(listing) { c.api.call { listing(listingId) } }
    }

    fun reply(reviewId: String, text: String, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                val updated = c.api.call { replyReview(reviewId, ReviewReplyInput(text.trim())) }
                pager.update { list -> list.map { if (it.id == reviewId) updated else it } }
                c.toaster.success(R.string.listing_reply_sent)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }
}

@Composable
fun ReviewsScreen(listingId: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "reviews-$listingId") { ReviewsViewModel(listingId, it) }
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val listing by vm.listing.collectAsStateWithLifecycle()
    val isOwner = listing.dataOrNull?.isOwner == true
    var replyTo by remember { mutableStateOf<Review?>(null) }
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    EvScreen(topBar = { EvTopBar(stringResource(R.string.listing_reviews), navigator::back, large = true, subtitle = listing.dataOrNull?.title) }) { padding ->
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            listing.dataOrNull?.rating?.let { r ->
                item {
                    EvCard(Modifier.fillMaxWidth()) {
                        Text(String.format(java.util.Locale.US, "%.1f", r), style = EvTheme.type.display)
                        Stars(r, 18.dp)
                        Text(stringResource(R.string.listing_reviews_count, listing.dataOrNull?.reviewsCount ?: 0), style = EvTheme.type.caption, color = EvTheme.colors.muted)
                    }
                }
            }
            if (state.isInitialLoading) item { LoadingBox() }
            items(state.items, key = { it.id }) { r ->
                EvCard(Modifier.fillMaxWidth(), color = EvTheme.colors.surfaceRaised) {
                    ReviewItem(r, onReply = if (isOwner) ({ replyTo = r }) else null)
                }
            }
            state.error?.let { err -> item { ErrorState(err, vm.pager::retry) } }
            if (state.isEmpty) item { EmptyState(EvIcons.Star, stringResource(R.string.listing_no_reviews)) }
            if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
        }
    }
    replyTo?.let { r ->
        var text by rememberSaveable(r.id) { mutableStateOf("") }
        EvBottomSheet(
            onDismiss = { replyTo = null },
            title = stringResource(R.string.listing_reply),
            footer = { PillButton(stringResource(R.string.common_send), { vm.reply(r.id, text) { replyTo = null } }, Modifier.fillMaxWidth(), enabled = text.isNotBlank()) },
        ) {
            Text(r.comment, style = EvTheme.type.body, color = EvTheme.colors.muted)
            EvTextField(text, { text = it }, stringResource(R.string.listing_reply), singleLine = false, minLines = 3, maxLength = 2000)
        }
    }
}
