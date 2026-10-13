package az.evtap.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.PaymentMethod

/**
 * Wallet vs bank card. The wallet option shows the balance (main + bonus) and is disabled with a reason when it does
 * not cover [amount] (minor units); the server is still authoritative (INSUFFICIENT_FUNDS).
 */
@Composable
fun PaymentMethodPicker(
    selected: PaymentMethod,
    onSelect: (PaymentMethod) -> Unit,
    walletBalance: Long?,
    amount: Long,
    modifier: Modifier = Modifier,
) {
    val insufficient = walletBalance != null && walletBalance < amount
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.payment_method), style = EvTheme.type.bodyStrong)
        MethodRow(
            icon = EvIcons.Wallet,
            title = stringResource(R.string.payment_wallet),
            subtitle = walletBalance?.let {
                stringResource(R.string.payment_wallet_balance, Format.money(it)) + if (insufficient) " · " + stringResource(R.string.payment_insufficient) else ""
            },
            selected = selected == PaymentMethod.WALLET,
            enabled = !insufficient,
            onClick = { onSelect(PaymentMethod.WALLET) },
        )
        MethodRow(
            icon = EvIcons.CreditCard,
            title = stringResource(R.string.payment_card),
            subtitle = null,
            selected = selected == PaymentMethod.CARD,
            enabled = true,
            onClick = { onSelect(PaymentMethod.CARD) },
        )
    }
}

@Composable
private fun MethodRow(icon: ImageVector, title: String, subtitle: String?, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = EvTheme.colors
    val shape = RoundedCornerShape(EvRadius.md)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clip(shape)
            .background(c.surfaceRaised)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) c.ink else c.hairline), shape)
            .pressable(onClick, enabled = enabled, role = Role.RadioButton)
            .semantics { this.selected = selected }
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(c.surfaceSunken), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.ink, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = EvTheme.type.bodyStrong)
            if (subtitle != null) Text(subtitle, style = EvTheme.type.caption, color = c.muted)
        }
        Box(
            Modifier.size(22.dp).clip(CircleShape).border(1.5.dp, if (selected) c.ink else c.subtle, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Box(Modifier.size(12.dp).clip(CircleShape).background(c.ink))
        }
    }
}

/** Label / value line of a price breakdown. */
@Composable
fun AmountRow(label: String, value: String, modifier: Modifier = Modifier, strong: Boolean = false, valueColor: Color = EvTheme.colors.ink) {
    Row(modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = if (strong) EvTheme.type.bodyStrong else EvTheme.type.body, color = if (strong) EvTheme.colors.ink else EvTheme.colors.inkSecondary, modifier = Modifier.weight(1f))
        Text(value, style = if (strong) EvTheme.type.h3 else EvTheme.type.bodyStrong, color = valueColor)
    }
}
