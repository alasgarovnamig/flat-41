package az.evtap.app.feature.business

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
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
import az.evtap.app.ui.components.ConfirmDialog
import az.evtap.app.ui.components.EvBottomSheet
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.PaymentMethodPicker
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.Segmented
import az.evtap.app.ui.components.SplitMeter
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.format.Format
import az.evtap.core.model.BillingPeriod
import az.evtap.core.model.CheckoutInput
import az.evtap.core.model.CheckoutResponse
import az.evtap.core.model.PaymentMethod
import az.evtap.core.model.PlanDef
import az.evtap.core.model.Subscription
import az.evtap.core.model.SubscriptionStatus
import az.evtap.core.pricing.Pricing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class BusinessViewModel(private val c: AppContainer) : ViewModel() {
    val subscription = MutableStateFlow<Load<Subscription?>>(Load.Loading)
    val busy = MutableStateFlow(false)

    init {
        load()
        viewModelScope.launch { c.catalog.ensureLoaded(force = true) }
    }

    fun load() = loadInto(subscription, showLoading = subscription.value !is Load.Ready) { c.api.mySubscription() }

    private fun act(block: suspend () -> Unit) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try {
                block()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                busy.value = false
            }
        }
    }

    fun subscribe(plan: PlanDef, period: BillingPeriod, method: PaymentMethod, onCheckout: (CheckoutResponse) -> Unit) = act {
        onCheckout(c.api.call { checkout(CheckoutInput.subscription(plan.code, period, method, DeepLinkParser.PAYMENT_RETURN_URL)) })
    }

    fun cancelRenew() = act {
        subscription.value = Load.Ready(c.api.call { cancelSubscription() })
        c.session.refreshMe()
    }

    fun resume() = act {
        subscription.value = Load.Ready(c.api.call { resumeSubscription() })
        c.session.refreshMe()
    }
}

@Composable
fun BusinessScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel { BusinessViewModel(it) }
    val sub by vm.subscription.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val catalog by container.catalog.catalog.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    var period by rememberSaveable { mutableStateOf(BillingPeriod.MONTH) }
    var buying by remember { mutableStateOf<PlanDef?>(null) }
    var cancelOpen by remember { mutableStateOf(false) }
    val locale = LocalAppLocale.current
    val context = LocalContext.current
    val c = EvTheme.colors
    val dark = EvTheme.isDark

    EvScreen(topBar = { EvTopBar(stringResource(R.string.business_title), navigator::back, large = true, subtitle = stringResource(R.string.business_subtitle)) }) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            sub.dataOrNull?.let { s ->
                val plan = catalog.plans.firstOrNull { it.code == s.planCode }
                EvCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.business_current), style = EvTheme.type.label, color = c.muted)
                            Text(plan?.name?.get(locale) ?: s.planCode.name, style = EvTheme.type.h2)
                        }
                        Tag(
                            stringResource(Labels.subscription(s.status)),
                            background = if (s.status == SubscriptionStatus.ACTIVE) c.successBg else c.warningBg,
                            content = if (s.status == SubscriptionStatus.ACTIVE) c.success else c.warning,
                        )
                    }
                    Text(
                        stringResource(if (s.autoRenew && s.status == SubscriptionStatus.ACTIVE) R.string.business_renews_on else R.string.business_ends_on, Dates.date(s.currentPeriodEnd)),
                        style = EvTheme.type.body,
                        color = c.inkSecondary,
                    )
                    s.cardMask?.let { Text(stringResource(R.string.business_card, it), style = EvTheme.type.caption, color = c.muted) }
                    Spacer(Modifier.height(14.dp))
                    Text(stringResource(R.string.business_usage), style = EvTheme.type.bodyStrong)
                    Spacer(Modifier.height(8.dp))
                    val quota = s.usage.listingQuota
                    if (quota > 0) {
                        SplitMeter(
                            leftLabel = stringResource(R.string.business_usage_listings, s.usage.activeListings, quota),
                            leftValue = buildAnnotatedString { append(s.usage.activeListings.toString()); withStyle(SpanStyle(color = c.muted)) { append(" / $quota") } },
                            rightLabel = stringResource(R.string.business_usage_bumps, s.usage.bumpsLeft),
                            rightValue = buildAnnotatedString { append(s.usage.bumpsLeft.toString()) },
                            leftFraction = s.usage.activeListings.toFloat() / quota,
                            rightFraction = 0f,
                        )
                    } else {
                        Text(stringResource(R.string.business_usage_listings, s.usage.activeListings, stringResource(R.string.business_unlimited)), style = EvTheme.type.body)
                        Text(stringResource(R.string.business_usage_bumps, s.usage.bumpsLeft), style = EvTheme.type.body)
                    }
                    Text(stringResource(R.string.business_usage_vip, s.usage.vipCreditsLeft), style = EvTheme.type.caption, color = c.inkSecondary, modifier = Modifier.padding(top = 8.dp))
                    Text(stringResource(R.string.business_usage_premium, s.usage.premiumCreditsLeft), style = EvTheme.type.caption, color = c.inkSecondary)
                    Spacer(Modifier.height(12.dp))
                    if (s.status == SubscriptionStatus.ACTIVE && s.autoRenew) {
                        PillButton(stringResource(R.string.business_cancel_renew), { cancelOpen = true }, Modifier.fillMaxWidth(), kind = PillKind.Secondary, loading = busy)
                    } else if (s.status == SubscriptionStatus.CANCELLED || (s.status == SubscriptionStatus.ACTIVE && !s.autoRenew)) {
                        PillButton(stringResource(R.string.business_resume), vm::resume, Modifier.fillMaxWidth(), loading = busy)
                    }
                }
            }

            Segmented(
                listOf(BillingPeriod.MONTH to stringResource(R.string.business_monthly), BillingPeriod.YEAR to stringResource(R.string.business_yearly) + " · " + stringResource(R.string.business_save2)),
                period,
                { period = it },
            )
            catalog.plans.filter { it.active }.forEach { plan ->
                val current = sub.dataOrNull?.planCode == plan.code && sub.dataOrNull?.status != SubscriptionStatus.EXPIRED
                PlanCard(plan, period, current, onSubscribe = { buying = plan })
            }
        }
    }

    buying?.let { plan ->
        var method by remember { mutableStateOf(PaymentMethod.CARD) }
        val price = Pricing.planPrice(plan, period)
        EvBottomSheet(
            onDismiss = { buying = null },
            title = plan.name.get(locale),
            footer = {
                PillButton("${stringResource(R.string.business_subscribe)} · ${Format.money(price)}", {
                    buying = null
                    vm.subscribe(plan, period, method) { res -> navigator.completeCheckout(res, context, c.canvas.toArgb(), dark) }
                }, Modifier.fillMaxWidth(), loading = busy)
            },
        ) {
            PaymentMethodPicker(method, { method = it }, me?.wallet?.let { it.balance + it.bonusBalance }, price)
        }
    }
    if (cancelOpen) {
        ConfirmDialog(
            title = stringResource(R.string.business_cancel_renew),
            text = stringResource(R.string.business_cancel_confirm),
            confirmLabel = stringResource(R.string.common_confirm),
            onConfirm = vm::cancelRenew,
            onDismiss = { cancelOpen = false },
        )
    }
}

@Composable
private fun PlanCard(plan: PlanDef, period: BillingPeriod, current: Boolean, onSubscribe: () -> Unit) {
    val c = EvTheme.colors
    val locale = LocalAppLocale.current
    val price = Pricing.planPrice(plan, period)
    val highlight = plan.code == az.evtap.core.model.PlanCode.PRO
    EvCard(Modifier.fillMaxWidth(), color = if (highlight) c.highlightBg else c.surface) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(plan.name.get(locale), style = EvTheme.type.h2, modifier = Modifier.weight(1f))
            if (current) Tag(stringResource(R.string.business_current), background = c.ink, content = c.onInk)
        }
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = c.muted)) { append("₼ ") }
                append(Format.moneyNumber(price))
                withStyle(SpanStyle(color = c.muted, fontSize = EvTheme.type.body.fontSize)) {
                    append(" " + stringResource(if (period == BillingPeriod.YEAR) R.string.business_per_year else R.string.business_per_month))
                }
            },
            style = EvTheme.type.number,
        )
        Spacer(Modifier.height(10.dp))
        val lines = listOf(
            stringResource(R.string.business_listings, if (plan.listingQuota < 0) stringResource(R.string.business_unlimited) else plan.listingQuota.toString()),
            stringResource(R.string.business_bumps, plan.monthlyBumps),
            plan.monthlyVipCredits.takeIf { it > 0 }?.let { stringResource(R.string.business_vip_credits, it) },
            plan.monthlyPremiumCredits.takeIf { it > 0 }?.let { stringResource(R.string.business_premium_credits, it) },
            stringResource(R.string.business_agents, plan.maxAgents),
        ).filterNotNull() + plan.features.mapNotNull { key -> Labels.planFeature(key)?.let { stringResource(it) } }
        lines.forEach { line ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 3.dp)) {
                Icon(EvIcons.Check, null, tint = c.success, modifier = Modifier.size(16.dp))
                Text(line, style = EvTheme.type.body)
            }
        }
        Spacer(Modifier.height(12.dp))
        PillButton(stringResource(R.string.business_subscribe), onSubscribe, Modifier.fillMaxWidth(), kind = if (highlight) PillKind.Primary else PillKind.Secondary, enabled = !current)
    }
}
