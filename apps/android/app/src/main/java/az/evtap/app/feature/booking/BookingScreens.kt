package az.evtap.app.feature.booking

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.platform.Intents
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.AmountRow
import az.evtap.app.ui.components.Avatar
import az.evtap.app.ui.components.BookingStatusTag
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.ConfirmDialog
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
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.PaymentMethodPicker
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.Segmented
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.NewChatRoute
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.format.Format
import az.evtap.core.model.Booking
import az.evtap.core.model.BookingStatus
import az.evtap.core.model.CancelInput
import az.evtap.core.model.CheckoutResponse
import az.evtap.core.model.PayBookingInput
import az.evtap.core.model.PaymentMethod
import az.evtap.core.model.ReviewInput
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// ───────────────────────────── Booking detail ─────────────────────────────

class BookingViewModel(private val id: String, private val c: AppContainer) : ViewModel() {
    val booking = MutableStateFlow<Load<Booking>>(Load.Loading)
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init {
        load()
    }

    fun load() = loadInto(booking, showLoading = booking.value !is Load.Ready) { c.api.call { booking(id) } }

    private fun act(block: suspend () -> Unit) {
        if (_busy.value) return
        _busy.value = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _busy.value = false
            }
        }
    }

    /** Resume an unpaid booking (POST /bookings/:id/pay) while its 30-minute hold is valid. */
    fun pay(method: PaymentMethod, onCheckout: (CheckoutResponse) -> Unit) = act {
        val res = c.api.call { payBooking(id, PayBookingInput(method, DeepLinkParser.PAYMENT_RETURN_URL)) }
        onCheckout(res)
    }

    fun cancel(reason: String) = act {
        booking.value = Load.Ready(c.api.call { cancelBooking(id, CancelInput(reason.trim().ifEmpty { null })) })
        c.toaster.success(R.string.bookings_cancelled)
    }

    fun review(rating: Int, comment: String, onDone: () -> Unit) = act {
        c.api.call { reviewBooking(id, ReviewInput(rating, comment.trim())) }
        c.toaster.success(R.string.bookings_review_sent)
        onDone()
        load()
    }
}

@Composable
fun BookingScreen(id: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "booking-$id") { BookingViewModel(id, it) }
    val load by vm.booking.collectAsStateWithLifecycle()
    EvScreen(topBar = { EvTopBar(stringResource(R.string.bookings_detail), navigator::back) }) { padding ->
        when (val b = load) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> ErrorState(b.error, vm::load, Modifier.padding(padding))
            is Load.Ready -> BookingDetail(b.data, vm, Modifier.padding(padding))
        }
    }
}

@Composable
private fun BookingDetail(b: Booking, vm: BookingViewModel, modifier: Modifier) {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val context = LocalContext.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    val isHost = me?.id == b.host.id
    val busy by vm.busy.collectAsStateWithLifecycle()
    val c = EvTheme.colors
    val dark = EvTheme.isDark
    var cancelOpen by remember { mutableStateOf(false) }
    var reviewOpen by remember { mutableStateOf(false) }
    var payOpen by remember { mutableStateOf(false) }
    val other = if (isHost) b.guest else b.host

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(EvRadius.lg)).pressable({ navigator.openListing(b.listing.id) }).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EvImage(b.listing.coverUrl, null, Modifier.size(80.dp).clip(RoundedCornerShape(EvRadius.md)))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(b.listing.title, style = EvTheme.type.bodyStrong, maxLines = 2)
                BookingStatusTag(b.status)
            }
        }

        EvCard(Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.bookings_dates), style = EvTheme.type.label, color = c.muted)
            Text("${Dates.date(b.checkIn)} → ${Dates.date(b.checkOut)}", style = EvTheme.type.h3)
            Text(stringResource(R.string.common_nights, b.nights) + " · " + stringResource(R.string.common_guests, b.guests), style = EvTheme.type.body, color = c.inkSecondary)
        }

        EvCard(Modifier.fillMaxWidth()) {
            Text(stringResource(if (isHost) R.string.bookings_guest else R.string.bookings_host), style = EvTheme.type.label, color = c.muted)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(other.avatarUrl, other.name)
                Column(Modifier.weight(1f)) {
                    Text(other.name, style = EvTheme.type.bodyStrong)
                    other.phone?.let { Text(Format.phone(it), style = EvTheme.type.caption, color = c.muted) }
                }
                other.phone?.let { p -> IconCircleButton(EvIcons.Phone, stringResource(R.string.listing_call), { Intents.dial(context, p) }, style = CircleStyle.Raised) }
                if (!isHost) {
                    IconCircleButton(EvIcons.MessageCircle, stringResource(R.string.bookings_contact), {
                        navigator.open(NewChatRoute(b.listing.id, b.listing.title, b.host.name))
                    }, style = CircleStyle.Raised)
                }
            }
        }

        EvCard(Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.booking_price_details), style = EvTheme.type.h3)
            Spacer(Modifier.height(6.dp))
            AmountRow(stringResource(R.string.booking_nights_times, Format.price(b.nightlyPrice, b.currency), b.nights), Format.money(b.subtotal, b.currency))
            if (isHost) {
                AmountRow(stringResource(R.string.bookings_host_fee), "−" + Format.money(b.hostFee, b.currency))
                AmountRow(stringResource(R.string.bookings_host_payout), Format.money(b.hostPayout, b.currency), strong = true)
                AmountRow(stringResource(R.string.bookings_payout), stringResource(Labels.payout(b.payoutStatus)))
            } else {
                AmountRow(stringResource(R.string.booking_service_fee), Format.money(b.guestFee, b.currency))
                AmountRow(stringResource(R.string.booking_total), Format.money(b.total, b.currency), strong = true)
            }
            if (b.refundedAmount > 0) AmountRow(stringResource(R.string.bookings_refunded), Format.money(b.refundedAmount, b.currency), valueColor = c.success)
        }

        if (b.status == BookingStatus.CANCELLED || b.status == BookingStatus.REFUNDED) {
            val who = b.cancelledBy?.let { stringResource(Labels.cancelledBy(it)) }
            NoticeBanner(
                listOfNotNull(who?.let { stringResource(R.string.bookings_cancelled_by, it) }, b.cancelReason).joinToString("\n").ifBlank { stringResource(Labels.bookingStatus(b.status)) },
                tone = NoticeTone.Warning,
            )
        }

        if (b.status == BookingStatus.PENDING_PAYMENT && !isHost) {
            NoticeBanner(stringResource(R.string.booking_held), tone = NoticeTone.Highlight)
            PillButton(stringResource(R.string.bookings_pay_now), { payOpen = true }, Modifier.fillMaxWidth(), icon = EvIcons.CreditCard, loading = busy)
        }
        if (b.canReview && !isHost) {
            PillButton(stringResource(R.string.bookings_write_review), { reviewOpen = true }, Modifier.fillMaxWidth(), kind = PillKind.Secondary, icon = EvIcons.Star)
        }
        if (b.status == BookingStatus.CONFIRMED || b.status == BookingStatus.PENDING_PAYMENT) {
            PillButton(stringResource(R.string.bookings_cancel), { cancelOpen = true }, Modifier.fillMaxWidth(), kind = PillKind.Destructive, loading = busy)
        }
        PillButton(stringResource(R.string.bookings_open_listing), { navigator.openListing(b.listing.id) }, Modifier.fillMaxWidth(), kind = PillKind.Ghost, trailingIcon = EvIcons.ArrowUpRight)
        Spacer(Modifier.height(16.dp))
    }

    if (cancelOpen) {
        var reason by rememberSaveable { mutableStateOf("") }
        ConfirmDialog(
            title = stringResource(R.string.bookings_cancel),
            text = stringResource(R.string.bookings_cancel_confirm),
            confirmLabel = stringResource(R.string.bookings_cancel),
            destructive = true,
            onConfirm = { vm.cancel(reason) },
            onDismiss = { cancelOpen = false },
        ) {
            EvTextField(reason, { reason = it }, stringResource(R.string.bookings_cancel_reason), singleLine = false, minLines = 2, maxLength = 500)
        }
    }
    if (reviewOpen) ReviewSheet(busy, onDismiss = { reviewOpen = false }) { rating, comment -> vm.review(rating, comment) { reviewOpen = false } }
    if (payOpen) {
        var method by remember { mutableStateOf(PaymentMethod.CARD) }
        EvBottomSheet(
            onDismiss = { payOpen = false },
            title = stringResource(R.string.bookings_pay_now),
            footer = {
                PillButton(Format.money(b.total, b.currency), {
                    payOpen = false
                    vm.pay(method) { res -> navigator.completeCheckout(res, context, c.canvas.toArgb(), dark) }
                }, Modifier.fillMaxWidth())
            },
        ) {
            PaymentMethodPicker(method, { method = it }, me?.wallet?.let { it.balance + it.bonusBalance }, b.total)
        }
    }
}

@Composable
private fun ReviewSheet(busy: Boolean, onDismiss: () -> Unit, onSubmit: (Int, String) -> Unit) {
    var rating by rememberSaveable { mutableIntStateOf(5) }
    var comment by rememberSaveable { mutableStateOf("") }
    val c = EvTheme.colors
    EvBottomSheet(
        onDismiss = onDismiss,
        title = stringResource(R.string.bookings_write_review),
        footer = { PillButton(stringResource(R.string.common_send), { onSubmit(rating, comment) }, Modifier.fillMaxWidth(), enabled = comment.trim().length >= 5, loading = busy) },
    ) {
        Text(stringResource(R.string.bookings_rating), style = EvTheme.type.label, color = c.inkSecondary)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (1..5).forEach { i ->
                IconCircleButton(
                    if (i <= rating) EvIcons.StarFilled else EvIcons.Star,
                    "$i / 5",
                    { rating = i },
                    style = CircleStyle.Transparent,
                    tint = if (i <= rating) c.star else c.subtle,
                    selected = i == rating,
                )
            }
        }
        EvTextField(comment, { comment = it }, stringResource(R.string.bookings_comment), singleLine = false, minLines = 4, maxLength = 2000)
    }
}

// ───────────────────────────── My bookings ─────────────────────────────

class BookingsViewModel(private val c: AppContainer) : ViewModel() {
    private val _role = MutableStateFlow("guest")
    val role: StateFlow<String> = _role.asStateFlow()
    val pager = Pager<Booking>(viewModelScope) { page, size -> c.api.call { bookings(_role.value, null, page, size) } }

    init {
        pager.refresh()
    }

    fun setRole(r: String) {
        _role.value = r
        pager.refresh()
    }
}

@Composable
fun BookingsScreen() {
    val navigator = LocalNavigator.current
    val vm = appViewModel { BookingsViewModel(it) }
    val role by vm.role.collectAsStateWithLifecycle()
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    EvScreen(topBar = { EvTopBar(stringResource(R.string.bookings_title), navigator::back, large = true) }) { padding ->
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Segmented(
                    listOf("guest" to stringResource(R.string.bookings_as_guest), "host" to stringResource(R.string.bookings_as_host)),
                    role,
                    vm::setRole,
                )
            }
            if (state.isInitialLoading) item { LoadingBox() }
            items(state.items, key = { it.id }) { b -> BookingRow(b) { navigator.open(az.evtap.app.ui.navigation.BookingRoute(b.id)) } }
            state.error?.let { item { ErrorState(it, vm.pager::retry) } }
            if (state.isEmpty) item { EmptyState(EvIcons.CalendarDays, stringResource(R.string.bookings_empty)) }
            if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
        }
    }
}

@Composable
private fun BookingRow(b: Booking, onClick: () -> Unit) {
    val c = EvTheme.colors
    EvCard(Modifier.fillMaxWidth(), color = c.surfaceRaised, contentPadding = PaddingValues(12.dp), onClick = onClick) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            EvImage(b.listing.coverUrl, null, Modifier.size(72.dp).clip(RoundedCornerShape(EvRadius.md)))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(b.listing.title, style = EvTheme.type.bodyStrong, maxLines = 1)
                Text("${Dates.date(b.checkIn)} → ${Dates.date(b.checkOut)}", style = EvTheme.type.caption, color = c.inkSecondary)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    BookingStatusTag(b.status)
                    Text(Format.money(b.total, b.currency), style = EvTheme.type.label)
                }
            }
        }
    }
}
