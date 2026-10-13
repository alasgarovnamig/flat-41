package az.evtap.app.feature.main

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.feature.home.HomeScreen
import az.evtap.app.feature.messages.MessagesScreen
import az.evtap.app.feature.profile.ProfileScreen
import az.evtap.app.feature.search.SearchScreen
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.components.glass
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.MainTab
import az.evtap.app.ui.navigation.PostRoute
import az.evtap.app.ui.theme.EvTheme

/** Height reserved at the bottom of tab content so lists never hide behind the floating bar. */
val TabBarClearance = 96.dp

/** Home / Search / + / Messages / Profile with a floating glass capsule (DESIGN_SYSTEM "TabBar (mobile)"). */
@Composable
fun MainScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val unread = (session as? SessionState.Authed)?.me?.unreadMessages ?: 0
    val holder = rememberSaveableStateHolder()
    val tab = navigator.tab

    BackHandler(enabled = tab != MainTab.HOME) { navigator.tab = MainTab.HOME }

    Box(Modifier.fillMaxSize().background(EvTheme.colors.canvas)) {
        holder.SaveableStateProvider(tab.name) {
            when (tab) {
                MainTab.HOME -> HomeScreen()
                MainTab.SEARCH -> SearchScreen()
                MainTab.MESSAGES -> MessagesScreen()
                MainTab.PROFILE -> ProfileScreen()
            }
        }
        FloatingTabBar(
            current = tab,
            unreadMessages = unread,
            onSelect = { navigator.tab = it },
            onPost = { navigator.requireAuth { navigator.open(PostRoute()) } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

@Composable
private fun FloatingTabBar(
    current: MainTab,
    unreadMessages: Int,
    onSelect: (MainTab) -> Unit,
    onPost: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = EvTheme.colors
    val shape = RoundedCornerShape(50)
    // Labels only fit for the active item; with very large font scales show icons only.
    val showLabel = LocalDensity.current.fontScale <= 1.3f
    Row(
        modifier
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
            .widthIn(max = 520.dp)
            .fillMaxWidth()
            .height(64.dp)
            .glass(shape)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        TabItem(EvIcons.Home, stringResource(R.string.tabs_home), current == MainTab.HOME, showLabel) { onSelect(MainTab.HOME) }
        TabItem(EvIcons.Search, stringResource(R.string.tabs_search), current == MainTab.SEARCH, showLabel) { onSelect(MainTab.SEARCH) }
        // Primary action: post a listing (always black).
        val postLabel = stringResource(R.string.tabs_post)
        Box(
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(c.ink)
                .pressable(onPost, role = Role.Button)
                .semantics { contentDescription = postLabel },
            contentAlignment = Alignment.Center,
        ) {
            Icon(EvIcons.Plus, null, tint = c.onInk, modifier = Modifier.size(24.dp))
        }
        TabItem(EvIcons.MessageCircle, stringResource(R.string.tabs_messages), current == MainTab.MESSAGES, showLabel, badge = unreadMessages) {
            onSelect(MainTab.MESSAGES)
        }
        TabItem(EvIcons.User, stringResource(R.string.tabs_profile), current == MainTab.PROFILE, showLabel) { onSelect(MainTab.PROFILE) }
    }
}

@Composable
private fun TabItem(icon: ImageVector, label: String, selected: Boolean, showLabel: Boolean, badge: Int = 0, onClick: () -> Unit) {
    val c = EvTheme.colors
    val motion = EvTheme.motion
    val description = if (badge > 0) "$label, $badge" else label
    Row(
        Modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(50))
            .background(if (selected) c.ink else androidx.compose.ui.graphics.Color.Transparent)
            .pressable(onClick, role = Role.Tab)
            .semantics {
                this.selected = selected
                contentDescription = description
            }
            .padding(horizontal = if (selected && showLabel) 16.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box {
            Icon(icon, null, tint = if (selected) c.onInk else c.ink, modifier = Modifier.size(22.dp))
            if (badge > 0) {
                Box(
                    Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-2).dp).size(9.dp).clip(CircleShape).background(c.danger),
                )
            }
        }
        AnimatedVisibility(
            visible = selected && showLabel,
            enter = fadeIn(motion.fast()) + expandHorizontally(motion.standard()),
            exit = fadeOut(motion.fast()) + shrinkHorizontally(motion.fast()),
        ) {
            Text(label, style = EvTheme.type.label, color = c.onInk, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
