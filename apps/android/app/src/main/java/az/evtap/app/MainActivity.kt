package az.evtap.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import az.evtap.app.data.SessionState
import az.evtap.app.ui.EvTapRoot
import az.evtap.core.deeplink.DeepLink
import az.evtap.core.deeplink.DeepLinkParser
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * Single activity (singleTask): Compose UI, deep links (evtap://…, https://evtap.az/…, push taps) and the bank
 * redirect `evtap://payment/result`, which re-delivers here via onNewIntent and closes the Custom Tab above.
 * AppCompatActivity is used for the per-app language back-port (AppCompatDelegate.setApplicationLocales).
 */
class MainActivity : AppCompatActivity() {
    private val links = MutableSharedFlow<DeepLink>(replay = 1, extraBufferCapacity = 4)

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        val container = (application as EvTapApp).container
        splash.setKeepOnScreenCondition { container.session.state.value is SessionState.Loading }
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        setContent { EvTapRoot(container, links) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val link = DeepLinkParser.parse(intent.dataString) ?: pushLink(intent) ?: return
        links.tryEmit(link)
    }

    /** Notification taps: FCM puts the message `data` keys into the launch intent's extras. */
    private fun pushLink(intent: Intent): DeepLink? {
        val extras = intent.extras ?: return null
        val keys = listOf("url", "conversationId", "paymentId", "bookingId", "listingId", "type", "notificationId")
        val data = keys.associateWith { extras.getString(it) }.filterValues { it != null }
        return if (data.isEmpty()) null else DeepLinkParser.fromPushData(data)
    }
}
