package az.evtap.app.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.platform.AppLanguage
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.Toast
import az.evtap.app.ui.common.ToastKind
import az.evtap.app.ui.common.asString
import az.evtap.app.ui.components.EvBottomSheet
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.softShadow
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.AppNavigator
import az.evtap.app.ui.navigation.EvTapNavHost
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTapTheme
import az.evtap.app.ui.theme.EvTheme
import az.evtap.app.ui.theme.ThemeMode
import az.evtap.core.deeplink.DeepLink
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@Composable
fun EvTapRoot(container: AppContainer, links: MutableSharedFlow<DeepLink>) {
    val themeMode by container.settings.themeMode.collectAsStateWithLifecycle(ThemeMode.SYSTEM)
    EvTapTheme(themeMode) {
        val nav = rememberNavController()
        val navigator = remember(nav) { AppNavigator(nav, container) }
        val session by container.session.state.collectAsStateWithLifecycle()
        val context = LocalContext.current
        CompositionLocalProvider(
            LocalAppContainer provides container,
            LocalNavigator provides navigator,
            LocalAppLocale provides AppLanguage.current(),
        ) {
            Box(Modifier.fillMaxSize().background(EvTheme.colors.canvas)) {
                EvTapNavHost(navigator)
                ToastHost(container)
            }
            if (navigator.authPrompt) LoginPromptSheet(onLogin = navigator::login, onDismiss = { navigator.authPrompt = false })
        }

        // Deep links / push taps, once the session is known (Loading → Guest | Authed).
        LaunchedEffect(navigator) {
            container.session.state.first { it !is SessionState.Loading }
            links.collect { link ->
                navigator.handle(link, context)
                links.resetReplayCache()
            }
        }

        // Android 13+: ask for notification permission once after login (only when push is configured).
        val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) container.appScope.launch { container.push.registerIfEnabled() }
        }
        val authed = session is SessionState.Authed
        LaunchedEffect(authed) {
            if (authed && Build.VERSION.SDK_INT >= 33 && container.push.isAvailable && !container.push.hasPermission()) {
                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}

/** Black pill snackbars at the top of the bottom area; errors keep the danger dot. Announced politely. */
@Composable
private fun ToastHost(container: AppContainer) {
    var current by remember { mutableStateOf<Toast?>(null) }
    LaunchedEffect(container) {
        container.toaster.toasts.collect { t ->
            current = t
            delay(if (t.kind == ToastKind.ERROR) 4_000 else 2_800)
            if (current == t) current = null
        }
    }
    val motion = EvTheme.motion
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(bottom = 96.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = current != null,
            enter = fadeIn(motion.fast()) + slideInVertically(motion.standard()) { it / 2 },
            exit = fadeOut(motion.fast()) + slideOutVertically(motion.fast()) { it / 2 },
        ) {
            val t = current
            if (t != null) {
                val c = EvTheme.colors
                Row(
                    Modifier
                        .padding(horizontal = 20.dp)
                        .widthIn(max = 520.dp)
                        .softShadow(RoundedCornerShape(50), 10.dp)
                        .clip(RoundedCornerShape(50))
                        .background(c.ink)
                        .padding(horizontal = 18.dp, vertical = 12.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val icon = when (t.kind) {
                        ToastKind.SUCCESS -> EvIcons.CheckCircle
                        ToastKind.ERROR -> EvIcons.AlertCircle
                        ToastKind.INFO -> EvIcons.Info
                    }
                    Icon(icon, null, tint = if (t.kind == ToastKind.ERROR) c.danger else c.accent, modifier = Modifier.size(18.dp))
                    Text(t.text.asString(), style = EvTheme.type.label, color = c.onInk)
                }
            }
        }
    }
}

@Composable
private fun LoginPromptSheet(onLogin: () -> Unit, onDismiss: () -> Unit) {
    EvBottomSheet(onDismiss = onDismiss, title = stringResource(R.string.auth_prompt_title)) {
        Text(stringResource(R.string.auth_prompt_body), style = EvTheme.type.body, color = EvTheme.colors.inkSecondary)
        PillButton(stringResource(R.string.common_login), onLogin, Modifier.fillMaxWidth(), icon = EvIcons.User)
        PillButton(stringResource(R.string.common_cancel), onDismiss, Modifier.fillMaxWidth(), kind = PillKind.Ghost)
    }
}
