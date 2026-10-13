package az.evtap.app.feature.promote

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.MoneyText
import az.evtap.app.ui.components.PaymentMethodPicker
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.PropertyRow
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.format.Format
import az.evtap.core.model.ApplyCreditInput
import az.evtap.core.model.CheckoutInput
import az.evtap.core.model.CheckoutResponse
import az.evtap.core.model.CreditType
import az.evtap.core.model.ListingDetail
import az.evtap.core.model.PaymentMethod
import az.evtap.core.model.PromotionType
import az.evtap.core.model.ServiceDef
import az.evtap.core.pricing.Pricing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private val GROUP_ORDER = listOf(PromotionType.PREMIUM, PromotionType.VIP, PromotionType.BUMP, PromotionType.AUTO_BUMP, PromotionType.HIGHLIGHT, PromotionType.URGENT)

data class PromoteState(
    /** One service per promotion type, or a bundle (mutually exclusive). */
    val picked: Map<PromotionType, String> = emptyMap(),
    val bundle: String? = null,
    val method: PaymentMethod = PaymentMethod.WALLET,
    val paying: Boolean = false,
    val creditBusy: CreditType? = null,
)

class PromoteViewModel(private val listingId: String, private val c: AppContainer) : ViewModel() {
    val listing = MutableStateFlow<Load<ListingDetail>>(Load.Loading)
    private val _state = MutableStateFlow(PromoteState())
    val state: StateFlow<PromoteState> = _state.asStateFlow()

    init {
        reload()
        viewModelScope.launch { c.catalog.ensureLoaded(force = true) }
        viewModelScope.launch { c.session.refreshMe() }
    }

    fun reload() = loadInto(listing, showLoading = listing.value !is Load.Ready) { c.api.call { listing(listingId) } }

    fun pick(type: PromotionType, code: String) = _state.update {
        val picked = if (it.picked[type] == code) it.picked - type else it.picked + (type to code)
        it.copy(picked = picked, bundle = null)
    }

    fun pickBundle(code: String) = _state.update { it.copy(bundle = if (it.bundle == code) null else code, picked = emptyMap()) }
    fun setMethod(m: PaymentMethod) = _state.update { it.copy(method = m) }

    fun pay(verification: Boolean, onCheckout: (CheckoutResponse) -> Unit) {
        val s = _state.value
        if (s.paying) return
        _state.update { it.copy(paying = true) }
        viewModelScope.launch {
            try {
                val input = if (verification) CheckoutInput.verification(listingId, s.method, DeepLinkParser.PAYMENT_RETURN_URL)
                else CheckoutInput.promotion(listingId, s.method, DeepLinkParser.PAYMENT_RETURN_URL, serviceCodes = s.picked.values.toList(), bundleCode = s.bundle)
                onCheckout(c.api.call { checkout(input) })
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _state.update { it.copy(paying = false) }
            }
        }
    }

    fun applyCredit(credit: CreditType) {
        _state.update { it.copy(creditBusy = credit) }
        viewModelScope.launch {
            try {
                c.api.call { applyCredit(listingId, ApplyCreditInput(credit)) }
                c.toaster.success(R.string.promote_credit_applied)
                c.session.refreshMe()
                reload()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _state.update { it.copy(creditBusy = null) }
            }
        }
    }
}

@Composable
fun PromoteScreen(id: String, upsell: Boolean) {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel(key = "promote-$id") { PromoteViewModel(id, it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val listing by vm.listing.collectAsStateWithLifecycle()
    val catalog by container.catalog.catalog.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    val locale = LocalAppLocale.current
    val context = LocalContext.current
    val c = EvTheme.colors
    val dark = EvTheme.isDark

    val services = catalog.services.filter { it.active }
    fun byCode(code: String) = services.firstOrNull { it.code == code }
    val selectedBundle = catalog.bundles.firstOrNull { it.code == state.bundle }
    val total = selectedBundle?.price ?: state.picked.values.sumOf { byCode(it)?.price ?: 0 }
    val wallet = me?.wallet?.let { it.balance + it.bonusBalance }
    val checkout: (CheckoutResponse) -> Unit = { res -> navigator.completeCheckout(res, context, c.canvas.toArgb(), dark) }

    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.promote_title), navigator::back, large = true) },
        bottomBar = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.promote_total), style = EvTheme.type.caption, color = c.muted)
                    MoneyText(total, style = EvTheme.type.h3)
                }
                PillButton(
                    stringResource(R.string.promote_pay),
                    { vm.pay(false, checkout) },
                    enabled = total > 0,
                    loading = state.paying,
                    icon = EvIcons.Sparkles,
                )
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (upsell) {
                EvCard(Modifier.fillMaxWidth(), color = c.highlightBg) {
                    Text(stringResource(R.string.post_upsell_title), style = EvTheme.type.h3)
                    Text(stringResource(R.string.post_upsell_text), style = EvTheme.type.body, color = c.inkSecondary)
                    Spacer(Modifier.height(8.dp))
                    PillButton(stringResource(R.string.post_later), { navigator.back() }, kind = PillKind.Ghost, size = PillSize.Small)
                }
            }
            listing.dataOrNull?.let { l ->
                PropertyRow(l, onClick = { navigator.openListing(l.id) }, thumb = 64.dp)
                l.promotions.forEach { p ->
                    Text(
                        "✓ " + (byCode(p.serviceCode)?.name?.get(locale) ?: p.type.name) + (p.endsAt?.let { " · " + stringResource(R.string.promote_active, Dates.date(it)) } ?: ""),
                        style = EvTheme.type.caption,
                        color = c.success,
                    )
                }
            }

            // ── Subscription credits
            val usage = me?.activeSubscription?.usage
            val credits = usage?.let {
                listOf(CreditType.BUMP to it.bumpsLeft, CreditType.VIP_7 to it.vipCreditsLeft, CreditType.PREMIUM_7 to it.premiumCreditsLeft).filter { (_, n) -> n > 0 }
            }.orEmpty()
            if (credits.isNotEmpty()) {
                EvCard(Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.promote_credits), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
                    credits.forEach { (credit, n) ->
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(Labels.credit(credit)), style = EvTheme.type.bodyStrong)
                                Text(stringResource(R.string.promote_credits_left, n), style = EvTheme.type.caption, color = c.muted)
                            }
                            PillButton(stringResource(R.string.promote_use_credit), { vm.applyCredit(credit) }, kind = PillKind.Secondary, size = PillSize.Small, loading = state.creditBusy == credit)
                        }
                    }
                }
            }

            // ── Bundles
            if (catalog.bundles.isNotEmpty()) {
                Text(stringResource(R.string.promote_bundles), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
                catalog.bundles.forEach { b ->
                    val saving = Pricing.bundleSavings(b, services)
                    OptionTile(
                        icon = EvIcons.Gift,
                        accent = c.premium,
                        title = b.name.get(locale),
                        subtitle = b.serviceCodes.mapNotNull { byCode(it)?.name?.get(locale) }.joinToString(" + "),
                        price = b.price,
                        tag = if (saving > 0) stringResource(R.string.promote_economy, Format.money(saving)) else null,
                        selected = state.bundle == b.code,
                        onClick = { vm.pickBundle(b.code) },
                    )
                }
            }

            // ── Single services, grouped by promotion type
            Text(stringResource(R.string.promote_services), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
            GROUP_ORDER.forEach { type ->
                val items = services.filter { it.promotionType == type }.sortedBy { it.sortOrder }
                items.forEach { s ->
                    OptionTile(
                        icon = iconFor(type),
                        accent = accentFor(type),
                        title = s.name.get(locale),
                        subtitle = s.description.get(locale),
                        price = s.price,
                        tag = null,
                        selected = state.picked[type] == s.code,
                        onClick = { vm.pick(type, s.code) },
                    )
                }
            }

            PaymentMethodPicker(state.method, vm::setMethod, wallet, total.coerceAtLeast(1))

            // ── Verification (separate checkout purpose)
            services.firstOrNull { it.code == "VERIFICATION" }?.let { v ->
                VerificationCard(v, locale, listing.dataOrNull?.isVerified == true, state.paying) { vm.pay(true, checkout) }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun VerificationCard(v: ServiceDef, locale: az.evtap.core.model.AppLocale, verified: Boolean, busy: Boolean, onPay: () -> Unit) {
    val c = EvTheme.colors
    EvCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(c.successBg), contentAlignment = Alignment.Center) {
                Icon(EvIcons.ShieldCheck, null, tint = c.success)
            }
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.promote_verification_title), style = EvTheme.type.bodyStrong)
                Text(v.description.get(locale), style = EvTheme.type.caption, color = c.muted)
            }
        }
        Spacer(Modifier.height(12.dp))
        if (verified) Tag(stringResource(R.string.badge_verified), background = c.successBg, content = c.success, icon = EvIcons.Check)
        else PillButton("${stringResource(R.string.promote_pay)} · ${Format.money(v.price)}", onPay, Modifier.fillMaxWidth(), kind = PillKind.Secondary, loading = busy)
    }
}

@Composable
private fun OptionTile(icon: ImageVector, accent: Color, title: String, subtitle: String?, price: Long, tag: String?, selected: Boolean, onClick: () -> Unit) {
    val c = EvTheme.colors
    val shape = RoundedCornerShape(EvRadius.lg)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .clip(shape)
            .background(c.surfaceRaised)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) c.ink else c.hairline), shape)
            .pressable(onClick, role = Role.Checkbox)
            .semantics { this.selected = selected }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(accent.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (accent == c.premium) c.ink else accent)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = EvTheme.type.bodyStrong)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = EvTheme.type.caption, color = c.muted)
            if (tag != null) Tag(tag, background = c.successBg, content = c.success)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(Format.money(price), style = EvTheme.type.bodyStrong)
            if (selected) Icon(EvIcons.CheckCircle, null, tint = c.ink, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun accentFor(t: PromotionType): Color = when (t) {
    PromotionType.PREMIUM -> EvTheme.colors.premium
    PromotionType.VIP -> EvTheme.colors.vip
    PromotionType.BUMP, PromotionType.AUTO_BUMP -> EvTheme.colors.info
    PromotionType.HIGHLIGHT -> EvTheme.colors.accentStrong
    PromotionType.URGENT -> EvTheme.colors.danger
}

private fun iconFor(t: PromotionType): ImageVector = when (t) {
    PromotionType.PREMIUM -> EvIcons.Sparkles
    PromotionType.VIP -> EvIcons.Star
    PromotionType.BUMP -> EvIcons.ArrowUp
    PromotionType.AUTO_BUMP -> EvIcons.Refresh
    PromotionType.HIGHLIGHT -> EvIcons.Palette
    PromotionType.URGENT -> EvIcons.Zap
}
