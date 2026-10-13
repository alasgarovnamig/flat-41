package az.evtap.app.feature.payment

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.BarcodeSpark
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.MoneyText
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.PaymentStatusTag
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.SectionHeader
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.BookingRoute
import az.evtap.app.ui.navigation.BusinessRoute
import az.evtap.app.ui.navigation.ListingRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.MainTab
import az.evtap.app.ui.navigation.MyListingsRoute
import az.evtap.app.ui.navigation.WalletRoute
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.format.Format
import az.evtap.core.model.CheckoutInput
import az.evtap.core.model.Payment
import az.evtap.core.model.PaymentPurpose
import az.evtap.core.model.PaymentStatus
import az.evtap.core.model.Wallet
import az.evtap.core.model.WalletTransaction
import az.evtap.core.model.WalletTxType
import az.evtap.core.pricing.Pricing
import az.evtap.core.realtime.RealtimeEvent
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.math.roundToLong

// ───────────────────────────── Payment result ─────────────────────────────

class PaymentResultViewModel(private val paymentId: String, private val c: AppContainer) : ViewModel() {
    private val _payment = MutableStateFlow<Payment?>(null)
    val payment: StateFlow<Payment?> = _payment.asStateFlow()
    private val _timedOut = MutableStateFlow(false)
    val timedOut: StateFlow<Boolean> = _timedOut.asStateFlow()

    init {
        // Poll GET /payments/:id every 2 s for up to 90 s; realtime `payment:updated` short-circuits.
        viewModelScope.launch {
            val started = System.currentTimeMillis()
            while (true) {
                runCatching { c.api.call { payment(paymentId) } }.onSuccess { _payment.value = it }
                if (_payment.value?.status?.isFinal == true) break
                if (System.currentTimeMillis() - started > 90_000) {
                    _timedOut.value = true
                    break
                }
                delay(2_000)
            }
            onFinal()
        }
        viewModelScope.launch {
            c.realtime.events.collect { e -> if (e is RealtimeEvent.PaymentUpdated && e.payment.id == paymentId) _payment.value = e.payment }
        }
    }

    private suspend fun onFinal() {
        if (_payment.value?.status?.isFinal == true) c.session.refreshMe() // wallet, quota, subscription
    }
}

@Composable
fun PaymentResultScreen(paymentId: String, statusHint: String?) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "payment-$paymentId") { PaymentResultViewModel(paymentId, it) }
    val p by vm.payment.collectAsStateWithLifecycle()
    val timedOut by vm.timedOut.collectAsStateWithLifecycle()
    val c = EvTheme.colors
    val status = p?.status?.takeIf { it.isFinal }
    val (icon, color, title) = when (status) {
        PaymentStatus.SUCCEEDED -> Triple(EvIcons.CheckCircle, c.success, stringResource(R.string.payment_success))
        PaymentStatus.FAILED -> Triple(EvIcons.XCircle, c.danger, stringResource(R.string.payment_failed))
        PaymentStatus.CANCELLED -> Triple(EvIcons.XCircle, c.muted, stringResource(R.string.payment_cancelled))
        PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED -> Triple(EvIcons.RotateCcw, c.warning, stringResource(R.string.payment_refunded))
        else -> Triple(EvIcons.Clock, c.ink, stringResource(if (timedOut) R.string.payment_pending_long else R.string.payment_processing))
    }
    EvScreen(
        topBar = { EvTopBar(null, onBack = { navigator.toMain(MainTab.HOME) }) },
        bottomBar = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val pay = p
                if (pay != null && status != null) {
                    nextAction(pay)?.let { (label, go) -> PillButton(label, go, Modifier.fillMaxWidth()) }
                }
                PillButton(stringResource(R.string.payment_back_home), { navigator.toMain(MainTab.HOME) }, Modifier.fillMaxWidth(), kind = PillKind.Secondary)
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        ) {
            Box(Modifier.size(96.dp).clip(CircleShape).background(c.surfaceSunken), contentAlignment = Alignment.Center) {
                if (status == null && !timedOut) CircularProgressIndicator(color = c.ink, strokeWidth = 2.dp, modifier = Modifier.size(40.dp))
                else Icon(icon, null, tint = color, modifier = Modifier.size(44.dp))
            }
            Text(title, style = EvTheme.type.h2, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite; heading() })
            p?.let { pay ->
                MoneyText(pay.amount, currency = pay.currency)
                Text(stringResource(Labels.purpose(pay.purpose)) + " · " + stringResource(Labels.method(pay.method)), style = EvTheme.type.body, color = c.inkSecondary)
                pay.cardMask?.let { Text(it, style = EvTheme.type.caption, color = c.muted) }
                if (status == PaymentStatus.FAILED) pay.failureReason?.let { NoticeBanner(it, tone = NoticeTone.Danger) }
            }
            if (p == null && statusHint != null) Text(statusHint, style = EvTheme.type.caption, color = c.muted)
        }
    }
}

@Composable
private fun nextAction(p: Payment): Pair<String, () -> Unit>? {
    val navigator = LocalNavigator.current
    return when {
        p.purpose == PaymentPurpose.BOOKING && p.bookingId != null -> stringResource(R.string.payment_to_booking) to { navigator.replace(BookingRoute(p.bookingId!!)) }
        p.purpose == PaymentPurpose.WALLET_TOPUP -> stringResource(R.string.payment_to_wallet) to { navigator.replace(WalletRoute) }
        p.purpose == PaymentPurpose.SUBSCRIPTION -> stringResource(R.string.payment_to_business) to { navigator.replace(BusinessRoute) }
        p.purpose == PaymentPurpose.LISTING_FEE -> stringResource(R.string.payment_to_my_listings) to { navigator.replace(MyListingsRoute) }
        p.listingId != null -> stringResource(R.string.payment_to_listing) to { navigator.replace(ListingRoute(p.listingId!!)) }
        else -> null
    }
}

// ───────────────────────────── Wallet ─────────────────────────────

class WalletViewModel(private val c: AppContainer) : ViewModel() {
    val wallet = MutableStateFlow<Load<Wallet>>(Load.Loading)
    val pager = Pager<WalletTransaction>(viewModelScope) { page, size -> c.api.call { walletTransactions(page, size) } }
    val busy = MutableStateFlow(false)

    init {
        refresh()
        viewModelScope.launch { c.catalog.ensureLoaded() }
    }

    fun refresh() {
        loadInto(wallet, showLoading = wallet.value !is Load.Ready) { c.api.call { wallet() } }
        pager.refresh()
    }

    fun topUp(amountMinor: Long, onCheckout: (az.evtap.core.model.CheckoutResponse) -> Unit) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try {
                onCheckout(c.api.call { checkout(CheckoutInput.topup(amountMinor, DeepLinkParser.PAYMENT_RETURN_URL)) })
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                busy.value = false
            }
        }
    }
}

@Composable
fun WalletScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel { WalletViewModel(it) }
    val wallet by vm.wallet.collectAsStateWithLifecycle()
    val tx by vm.pager.state.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val catalog by container.catalog.catalog.collectAsStateWithLifecycle()
    val settings = catalog.settings
    var amountText by rememberSaveable { mutableStateOf("") }
    val amountMinor = amountText.replace(',', '.').toDoubleOrNull()?.let { (it * 100).roundToLong() } ?: 0L
    val bonus = Pricing.topupBonus(amountMinor, settings.topupBonuses)
    val inRange = amountMinor in settings.minTopup..settings.maxTopup
    val context = LocalContext.current
    val c = EvTheme.colors
    val dark = EvTheme.isDark
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    EvScreen(topBar = { EvTopBar(stringResource(R.string.wallet_title), navigator::back, large = true) }) { padding ->
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                when (val w = wallet) {
                    is Load.Ready -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Balance StatCard with the spending barcode of the latest transactions
                        EvCard(Modifier.weight(1.4f)) {
                            Text(stringResource(R.string.wallet_balance), style = EvTheme.type.label, color = c.muted)
                            MoneyText(w.data.balance, currency = w.data.currency)
                            Spacer(Modifier.height(10.dp))
                            BarcodeSpark(tx.items.take(32).reversed().map { kotlin.math.abs(it.amount).toFloat() }, height = 32.dp)
                        }
                        EvCard(Modifier.weight(1f), color = c.highlightBg) {
                            Text(stringResource(R.string.wallet_bonus), style = EvTheme.type.label, color = c.inkSecondary)
                            MoneyText(w.data.bonusBalance, currency = w.data.currency, style = EvTheme.type.h3)
                        }
                    }
                    is Load.Failed -> ErrorState(w.error, vm::refresh)
                    Load.Loading -> LoadingBox()
                }
            }
            item {
                EvCard(Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.wallet_topup), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
                    Spacer(Modifier.height(12.dp))
                    EvTextField(
                        amountText,
                        { v -> amountText = v.filter { it.isDigit() || it == '.' || it == ',' }.take(9) },
                        stringResource(R.string.wallet_amount),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        hint = stringResource(R.string.wallet_limits, Format.money(settings.minTopup), Format.money(settings.maxTopup)),
                        error = if (amountText.isNotBlank() && !inRange) stringResource(R.string.wallet_limits, Format.money(settings.minTopup), Format.money(settings.maxTopup)) else null,
                    )
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(20L, 50L, 100L, 300L).forEach { v ->
                            az.evtap.app.ui.components.ChoiceChip("$v ₼", amountMinor == v * 100, { amountText = v.toString() }, onCanvas = false)
                        }
                    }
                    if (bonus > 0) {
                        Spacer(Modifier.height(10.dp))
                        Tag(stringResource(R.string.wallet_bonus_info, Format.money(bonus)), background = c.successBg, content = c.success, icon = EvIcons.Gift)
                    }
                    Spacer(Modifier.height(12.dp))
                    PillButton(
                        stringResource(R.string.wallet_topup) + if (inRange) " · " + Format.money(amountMinor) else "",
                        { vm.topUp(amountMinor) { res -> navigator.completeCheckout(res, context, c.canvas.toArgb(), dark) } },
                        Modifier.fillMaxWidth(),
                        enabled = inRange,
                        loading = busy,
                        icon = EvIcons.CreditCard,
                    )
                }
            }
            if (settings.topupBonuses.isNotEmpty()) {
                item {
                    EvCard(Modifier.fillMaxWidth(), color = c.surfaceRaised) {
                        Text(stringResource(R.string.wallet_tiers_title), style = EvTheme.type.bodyStrong)
                        settings.topupBonuses.sortedBy { it.minAmount }.forEach { t ->
                            Text(
                                stringResource(R.string.wallet_tier, Format.money(t.minAmount), Format.area(t.bonusPercent)),
                                style = EvTheme.type.body,
                                color = c.inkSecondary,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                        Text(stringResource(R.string.wallet_bonus_first), style = EvTheme.type.caption, color = c.muted, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
            item { SectionHeader(stringResource(R.string.wallet_transactions)) }
            if (tx.isInitialLoading) item { LoadingBox() }
            items(tx.items, key = { it.id }) { t -> TxRow(t) }
            tx.error?.let { item { ErrorState(it, vm.pager::retry) } }
            if (tx.isEmpty) item { EmptyState(EvIcons.Wallet, stringResource(R.string.wallet_empty)) }
            if (tx.loading && tx.items.isNotEmpty()) item { LoadingFooter() }
        }
    }
}

@Composable
private fun TxRow(t: WalletTransaction) {
    val c = EvTheme.colors
    val positive = t.amount >= 0
    val icon: ImageVector = when (t.type) {
        WalletTxType.TOPUP -> EvIcons.CreditCard
        WalletTxType.BONUS -> EvIcons.Gift
        WalletTxType.SPEND -> EvIcons.Sparkles
        WalletTxType.REFUND -> EvIcons.RotateCcw
        WalletTxType.PAYOUT -> EvIcons.Banknote
        WalletTxType.ADJUSTMENT -> EvIcons.Settings
    }
    MoneyRow(icon, stringResource(Labels.walletTx(t.type)), t.description, Dates.dateTime(t.createdAt), (if (positive) "+" else "−") + Format.money(kotlin.math.abs(t.amount)), if (positive) c.success else c.ink)
}

@Composable
fun MoneyRow(icon: ImageVector, title: String, subtitle: String?, date: String, amount: String, amountColor: Color, trailing: (@Composable () -> Unit)? = null) {
    val c = EvTheme.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(c.surfaceSunken), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.ink, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = EvTheme.type.bodyStrong, maxLines = 1)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = EvTheme.type.caption, color = c.inkSecondary, maxLines = 2)
            Text(date, style = EvTheme.type.caption, color = c.muted)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(amount, style = EvTheme.type.bodyStrong, color = amountColor)
            trailing?.invoke()
        }
    }
}

// ───────────────────────────── Payments history ─────────────────────────────

class PaymentsViewModel(private val c: AppContainer) : ViewModel() {
    val pager = Pager<Payment>(viewModelScope) { page, size -> c.api.call { payments(page, size) } }
    init {
        pager.refresh()
    }
}

@Composable
fun PaymentsScreen() {
    val navigator = LocalNavigator.current
    val vm = appViewModel { PaymentsViewModel(it) }
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }
    EvScreen(topBar = { EvTopBar(stringResource(R.string.payments_title), navigator::back, large = true) }) { padding ->
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
        ) {
            if (state.isInitialLoading) item { LoadingBox() }
            items(state.items, key = { it.id }) { p ->
                val icon = when (p.purpose) {
                    PaymentPurpose.WALLET_TOPUP -> EvIcons.Wallet
                    PaymentPurpose.PROMOTION -> EvIcons.Sparkles
                    PaymentPurpose.LISTING_FEE -> EvIcons.FileText
                    PaymentPurpose.SUBSCRIPTION -> EvIcons.Briefcase
                    PaymentPurpose.BOOKING -> EvIcons.CalendarDays
                    PaymentPurpose.VERIFICATION -> EvIcons.ShieldCheck
                }
                MoneyRow(
                    icon,
                    stringResource(Labels.purpose(p.purpose)),
                    listOfNotNull(p.description.takeIf { it.isNotBlank() }, stringResource(Labels.method(p.method)), p.cardMask).joinToString(" · "),
                    Dates.dateTime(p.createdAt),
                    Format.money(p.amount, p.currency),
                    EvTheme.colors.ink,
                ) { PaymentStatusTag(p.status) }
            }
            state.error?.let { item { ErrorState(it, vm.pager::retry) } }
            if (state.isEmpty) item { EmptyState(EvIcons.Receipt, stringResource(R.string.payments_empty)) }
            if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
        }
    }
}
