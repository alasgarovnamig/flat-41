package az.evtap.app.feature.booking

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.UiText
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.asString
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.AmountRow
import az.evtap.app.ui.components.CalendarLegend
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.MonthView
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.PaymentMethodPicker
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PropertyRow
import az.evtap.app.ui.components.Stepper
import az.evtap.app.ui.components.WeekdayHeader
import az.evtap.app.ui.components.monthsFrom
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.booking.DateRange
import az.evtap.core.booking.NightAvailability
import az.evtap.core.format.Format
import az.evtap.core.model.Availability
import az.evtap.core.model.BookingQuote
import az.evtap.core.model.BookingQuoteInput
import az.evtap.core.model.CheckoutResponse
import az.evtap.core.model.CreateBookingInput
import az.evtap.core.model.ListingDetail
import az.evtap.core.model.PaymentMethod
import az.evtap.core.deeplink.DeepLinkParser
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate

data class BookUiState(
    val range: DateRange = DateRange(),
    val guests: Int = 1,
    val quote: BookingQuote? = null,
    val quoting: Boolean = false,
    val quoteError: UiText? = null,
    val method: PaymentMethod = PaymentMethod.CARD,
    val submitting: Boolean = false,
)

class BookViewModel(private val listingId: String, private val c: AppContainer) : ViewModel() {
    val listing = MutableStateFlow<Load<ListingDetail>>(Load.Loading)
    private val _availability = MutableStateFlow<NightAvailability?>(null)
    val availability: StateFlow<NightAvailability?> = _availability.asStateFlow()
    private val _ui = MutableStateFlow(BookUiState())
    val ui: StateFlow<BookUiState> = _ui.asStateFlow()
    private var quoteJob: Job? = null
    val today: LocalDate = LocalDate.now()

    init {
        loadInto(listing) { c.api.call { listing(listingId) } }
        viewModelScope.launch {
            runCatching {
                c.api.call { availability(listingId, today.toString(), today.plusMonths(12).toString()) }
            }.onSuccess { _availability.value = NightAvailability(it) }
                .onFailure { _availability.value = NightAvailability(Availability(listingId)) }
        }
        viewModelScope.launch { c.session.refreshMe() } // fresh wallet balance
        viewModelScope.launch { c.catalog.ensureLoaded() } // fee % and cancellation policy
    }

    fun tap(day: LocalDate) {
        _ui.update { it.copy(range = it.range.tap(day, today, _availability.value), quote = null, quoteError = null) }
        requote()
    }

    fun setGuests(n: Int) {
        _ui.update { it.copy(guests = n) }
        requote()
    }

    fun setMethod(m: PaymentMethod) = _ui.update { it.copy(method = m) }

    /** Live quote (POST /bookings/quote) once both dates are chosen, debounced. */
    private fun requote() {
        quoteJob?.cancel()
        val s = _ui.value
        val inDate = s.range.checkIn
        val outDate = s.range.checkOut
        if (inDate == null || outDate == null) return
        _ui.update { it.copy(quoting = true) }
        quoteJob = viewModelScope.launch {
            delay(250)
            try {
                val q = c.api.call { quote(BookingQuoteInput(listingId, inDate.toString(), outDate.toString(), s.guests)) }
                _ui.update { it.copy(quote = q, quoting = false, quoteError = null) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(quoting = false, quoteError = UiText.error(e)) }
            }
        }
    }

    fun book(onCheckout: (CheckoutResponse) -> Unit) {
        val s = _ui.value
        val inDate = s.range.checkIn ?: return
        val outDate = s.range.checkOut ?: return
        if (s.submitting) return
        _ui.update { it.copy(submitting = true) }
        viewModelScope.launch {
            try {
                val res = c.api.call {
                    createBooking(CreateBookingInput(listingId, inDate.toString(), outDate.toString(), s.guests, s.method, DeepLinkParser.PAYMENT_RETURN_URL))
                }
                onCheckout(res.checkout)
            } catch (e: Exception) {
                c.toaster.error(e)
                requote()
            } finally {
                _ui.update { it.copy(submitting = false) }
            }
        }
    }
}

@Composable
fun BookScreen(listingId: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "book-$listingId") { BookViewModel(listingId, it) }
    val listing by vm.listing.collectAsStateWithLifecycle()
    val nights by vm.availability.collectAsStateWithLifecycle()
    val ui by vm.ui.collectAsStateWithLifecycle()
    val container = az.evtap.app.ui.common.LocalAppContainer.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? az.evtap.app.data.SessionState.Authed)?.me
    val context = LocalContext.current
    val c = EvTheme.colors
    val dark = EvTheme.isDark

    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.booking_title), navigator::back) },
        bottomBar = {
            val l = listing.dataOrNull
            val q = ui.quote
            PillButton(
                stringResource(R.string.booking_book_and_pay) + (q?.let { " · " + Format.money(it.total, it.currency) } ?: ""),
                {
                    vm.book { res -> navigator.completeCheckout(res, context, c.canvas.toArgb(), dark) }
                },
                Modifier.fillMaxWidth(),
                enabled = l != null && q != null && q.available && !ui.quoting,
                loading = ui.submitting,
            )
        },
    ) { padding ->
        when (val l = listing) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> ErrorState(l.error, onRetry = null, modifier = Modifier.padding(padding))
            is Load.Ready -> Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                PropertyRow(l.data, onClick = { navigator.back() }, thumb = 72.dp)
                EvCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
                    Text(
                        ui.range.let { r ->
                            when {
                                r.checkIn == null -> stringResource(R.string.booking_select_dates)
                                r.checkOut == null -> stringResource(R.string.booking_select_check_out)
                                else -> "${Dates.dayMonth(r.checkIn!!)} → ${Dates.dayMonth(r.checkOut!!)} · " + stringResource(R.string.common_nights, r.nights)
                            }
                        },
                        style = EvTheme.type.h3,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    l.data.minNights?.let { Text(stringResource(R.string.booking_min_nights, it), style = EvTheme.type.caption, color = c.muted) }
                    Spacer(Modifier.height(10.dp))
                    CalendarLegend(listOf(c.ink to stringResource(R.string.booking_legend_selected), c.subtle to stringResource(R.string.booking_legend_booked)))
                    Spacer(Modifier.height(8.dp))
                    WeekdayHeader()
                    monthsFrom(vm.today, 6).forEach { m ->
                        MonthView(m, { ui.range.stateOf(it, vm.today, nights) }, vm::tap)
                    }
                }
                EvCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
                    Stepper(ui.guests, vm::setGuests, stringResource(R.string.booking_guests), min = 1, max = l.data.maxGuests ?: 50)
                    l.data.maxGuests?.let { Text(stringResource(R.string.booking_max_guests, it), style = EvTheme.type.caption, color = c.muted) }
                }
                ui.quoteError?.let { NoticeBanner(it.asString(), tone = NoticeTone.Danger) }
                ui.quote?.let { q ->
                    EvCard(Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.booking_price_details), style = EvTheme.type.h3)
                        Spacer(Modifier.height(8.dp))
                        if (!q.available) {
                            NoticeBanner(q.unavailableReason?.let { reason -> az.evtap.app.ui.common.errorCodeString(reason)?.let { stringResource(it) } ?: reason }
                                ?: stringResource(R.string.booking_unavailable), tone = NoticeTone.Danger)
                        }
                        AmountRow(stringResource(R.string.booking_nights_times, Format.price(q.nightlyPrice, q.currency), q.nights), Format.money(q.subtotal, q.currency))
                        AmountRow(stringResource(R.string.booking_service_fee), Format.money(q.guestFee, q.currency))
                        AmountRow(stringResource(R.string.booking_total), Format.money(q.total, q.currency), strong = true)
                        Text(stringResource(R.string.booking_held), style = EvTheme.type.caption, color = c.muted)
                    }
                    PaymentMethodPicker(ui.method, vm::setMethod, me?.wallet?.let { it.balance + it.bonusBalance }, q.total)
                }
                val hours = container.catalog.catalog.collectAsStateWithLifecycle().value.settings.freeCancellationHours
                EvCard(Modifier.fillMaxWidth(), color = c.surfaceRaised) {
                    Text(stringResource(R.string.booking_policy_title), style = EvTheme.type.bodyStrong)
                    Text(stringResource(R.string.booking_policy_text, hours), style = EvTheme.type.caption, color = c.inkSecondary)
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
