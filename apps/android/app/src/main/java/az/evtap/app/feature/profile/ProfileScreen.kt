package az.evtap.app.feature.profile

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.feature.main.TabBarClearance
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.components.Avatar
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.CountBubble
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.MoneyText
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.AgencyRoute
import az.evtap.app.ui.navigation.BookingsRoute
import az.evtap.app.ui.navigation.BusinessRoute
import az.evtap.app.ui.navigation.EditProfileRoute
import az.evtap.app.ui.navigation.FavoritesRoute
import az.evtap.app.ui.navigation.HostCalendarRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.MyListingsRoute
import az.evtap.app.ui.navigation.NotificationsRoute
import az.evtap.app.ui.navigation.PageRoute
import az.evtap.app.ui.navigation.PagesRoute
import az.evtap.app.ui.navigation.PaymentsRoute
import az.evtap.app.ui.navigation.SavedSearchesRoute
import az.evtap.app.ui.navigation.SettingsRoute
import az.evtap.app.ui.navigation.WalletRoute
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.AccountType

@Composable
fun ProfileScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val c = EvTheme.colors
    var logoutOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(session is SessionState.Authed) { if (session is SessionState.Authed) container.session.refreshMe() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = TabBarClearance + 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.tabs_profile), style = EvTheme.type.h1, modifier = Modifier.weight(1f).semantics { heading() })
            IconCircleButton(EvIcons.Settings, stringResource(R.string.settings_title), { navigator.open(SettingsRoute) }, style = CircleStyle.Raised)
        }
        val s = session
        if (s !is SessionState.Authed) {
            EvCard(Modifier.fillMaxWidth()) {
                EmptyState(EvIcons.User, stringResource(R.string.profile_guest_title), body = stringResource(R.string.profile_guest_text),
                    actionLabel = stringResource(R.string.common_login), onAction = navigator::login)
            }
        } else {
            val me = s.me
            // ── Identity
            EvCard(Modifier.fillMaxWidth(), onClick = { navigator.open(EditProfileRoute) }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(me?.avatarUrl, me?.name.orEmpty(), size = 60.dp)
                    Column(Modifier.weight(1f)) {
                        Text(me?.name?.ifBlank { null } ?: me?.phone?.let { Format.phone(it) } ?: "…", style = EvTheme.type.h3)
                        Text(listOfNotNull(me?.phone?.let { Format.phone(it) }, me?.email).joinToString(" · "), style = EvTheme.type.caption, color = c.muted)
                        if (me?.accountType == AccountType.BUSINESS) Tag(stringResource(R.string.badge_business), Modifier.padding(top = 4.dp), icon = EvIcons.Briefcase)
                    }
                    Icon(EvIcons.ChevronRight, null, tint = c.inkSecondary)
                }
            }
            // ── Wallet stat (big quiet number + barcode)
            if (me != null) {
                EvCard(Modifier.fillMaxWidth(), onClick = { navigator.open(WalletRoute) }) {
                    Row(verticalAlignment = Alignment.Top) {
                        Text(stringResource(R.string.profile_balance), style = EvTheme.type.h3, modifier = Modifier.weight(1f))
                        IconCircleButton(EvIcons.ArrowUpRight, stringResource(R.string.profile_wallet), { navigator.open(WalletRoute) }, style = CircleStyle.Raised, size = 36.dp, iconSize = 16.dp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            MoneyText(me.wallet.balance, currency = me.wallet.currency)
                            Text(stringResource(R.string.profile_bonus, Format.money(me.wallet.bonusBalance)), style = EvTheme.type.caption, color = c.muted)
                            val q = me.quota
                            Text(
                                if (q.unlimited) stringResource(R.string.post_quota_unlimited) else stringResource(R.string.profile_quota, q.remaining, q.freeLimit),
                                style = EvTheme.type.caption,
                                color = c.muted,
                            )
                        }
                    }
                }
            }
            Section(stringResource(R.string.profile_section_account)) {
                MenuRow(EvIcons.LayoutList, stringResource(R.string.profile_my_listings)) { navigator.open(MyListingsRoute) }
                MenuRow(EvIcons.Heart, stringResource(R.string.favorites_title)) { navigator.open(FavoritesRoute) }
                MenuRow(EvIcons.CalendarDays, stringResource(R.string.profile_bookings)) { navigator.open(BookingsRoute) }
                MenuRow(EvIcons.Calendar, stringResource(R.string.profile_host_calendar)) { navigator.open(HostCalendarRoute()) }
                MenuRow(EvIcons.Bell, stringResource(R.string.profile_notifications), badge = me?.unreadNotifications ?: 0) { navigator.open(NotificationsRoute) }
                MenuRow(EvIcons.Bookmark, stringResource(R.string.profile_saved_searches)) { navigator.open(SavedSearchesRoute) }
            }
            Section(stringResource(R.string.profile_section_money)) {
                MenuRow(EvIcons.Wallet, stringResource(R.string.profile_wallet)) { navigator.open(WalletRoute) }
                MenuRow(EvIcons.Receipt, stringResource(R.string.profile_payments)) { navigator.open(PaymentsRoute) }
                MenuRow(
                    EvIcons.Briefcase,
                    stringResource(R.string.profile_business),
                    trailing = me?.activeSubscription?.let { sub -> stringResource(Labels.subscription(sub.status)) },
                ) { navigator.open(BusinessRoute) }
                MenuRow(EvIcons.Building, stringResource(R.string.profile_agency)) { navigator.open(AgencyRoute) }
            }
        }
        Section(stringResource(R.string.profile_section_info)) {
            MenuRow(EvIcons.Info, stringResource(R.string.profile_about)) { navigator.open(PageRoute("about")) }
            MenuRow(EvIcons.LifeBuoy, stringResource(R.string.profile_help)) { navigator.open(PageRoute("help")) }
            MenuRow(EvIcons.ScrollText, stringResource(R.string.profile_terms)) { navigator.open(PageRoute("terms")) }
            MenuRow(EvIcons.Shield, stringResource(R.string.profile_privacy)) { navigator.open(PageRoute("privacy")) }
            MenuRow(EvIcons.FileText, stringResource(R.string.pages_all)) { navigator.open(PagesRoute) }
        }
        if (session is SessionState.Authed) {
            PillButton(stringResource(R.string.common_logout), { logoutOpen = true }, Modifier.fillMaxWidth(), kind = az.evtap.app.ui.components.PillKind.Ghost, icon = EvIcons.LogOut)
        }
        Text(stringResource(R.string.profile_version, az.evtap.app.BuildConfig.VERSION_NAME), style = EvTheme.type.caption, color = c.muted, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
    if (logoutOpen) {
        az.evtap.app.ui.components.ConfirmDialog(
            title = stringResource(R.string.common_logout),
            text = stringResource(R.string.settings_logout_confirm),
            confirmLabel = stringResource(R.string.common_logout),
            destructive = true,
            onConfirm = { scope.launch { container.session.logout() } },
            onDismiss = { logoutOpen = false },
        )
    }
}

@Composable
fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = EvTheme.type.label, color = EvTheme.colors.muted, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp).semantics { heading() })
        EvCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)) { content() }
    }
}

@Composable
fun MenuRow(icon: ImageVector, label: String, badge: Int = 0, trailing: String? = null, onClick: () -> Unit) {
    val c = EvTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(EvRadius.md)).pressable(onClick).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(c.surfaceRaised), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.ink, modifier = Modifier.size(18.dp))
        }
        Text(label, style = EvTheme.type.body, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = EvTheme.type.caption, color = c.muted)
        if (badge > 0) CountBubble(badge)
        Icon(EvIcons.ChevronRight, null, tint = c.subtle, modifier = Modifier.size(18.dp))
    }
}
