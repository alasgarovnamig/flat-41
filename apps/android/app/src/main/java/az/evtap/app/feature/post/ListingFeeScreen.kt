package az.evtap.app.feature.post

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.MoneyText
import az.evtap.app.ui.components.PaymentMethodPicker
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.format.Format
import az.evtap.core.model.CheckoutInput
import az.evtap.core.model.CheckoutResponse
import az.evtap.core.model.PaymentMethod
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class ListingFeeViewModel(private val listingId: String, private val c: AppContainer) : ViewModel() {
    val busy = MutableStateFlow(false)

    init {
        viewModelScope.launch { c.session.refreshMe() }
        viewModelScope.launch { c.catalog.ensureLoaded() }
    }

    fun pay(method: PaymentMethod, onCheckout: (CheckoutResponse) -> Unit) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try {
                onCheckout(c.api.call { checkout(CheckoutInput.listingFee(listingId, method, DeepLinkParser.PAYMENT_RETURN_URL)) })
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                busy.value = false
            }
        }
    }
}

/** DRAFT listing waiting for the listing fee (free monthly quota used up). */
@Composable
fun ListingFeeScreen(id: String) {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel(key = "fee-$id") { ListingFeeViewModel(id, it) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val catalog by container.catalog.catalog.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    val fee = me?.quota?.listingFee?.takeIf { it > 0 } ?: catalog.settings.listingFee
    var method by remember { mutableStateOf(PaymentMethod.WALLET) }
    val context = LocalContext.current
    val c = EvTheme.colors
    val dark = EvTheme.isDark
    val wallet = me?.wallet?.let { it.balance + it.bonusBalance }
    if (wallet != null && wallet < fee && method == PaymentMethod.WALLET) method = PaymentMethod.CARD

    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.post_fee_title), navigator::back, large = true) },
        bottomBar = {
            PillButton(
                stringResource(R.string.post_pay_fee, Format.money(fee)),
                { vm.pay(method) { res -> navigator.completeCheckout(res, context, c.canvas.toArgb(), dark) } },
                Modifier.fillMaxWidth(),
                icon = EvIcons.CreditCard,
                loading = busy,
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            EvCard(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.payment_amount), style = EvTheme.type.label, color = c.muted)
                MoneyText(fee)
                Text(stringResource(R.string.post_fee_text), style = EvTheme.type.body, color = c.inkSecondary, modifier = Modifier.padding(top = 8.dp))
            }
            PaymentMethodPicker(method, { method = it }, wallet, fee)
            PillButton(stringResource(R.string.post_later), { navigator.back() }, Modifier.fillMaxWidth(), kind = az.evtap.app.ui.components.PillKind.Ghost)
        }
    }
}
