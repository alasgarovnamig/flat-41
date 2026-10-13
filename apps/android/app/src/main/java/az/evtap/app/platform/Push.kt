package az.evtap.app.platform

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import az.evtap.app.EvTapApp
import az.evtap.app.MainActivity
import az.evtap.app.R
import az.evtap.app.data.SettingsStore
import az.evtap.core.api.ApiClient
import az.evtap.core.model.PushTokenInput
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * FCM token registration: `POST /users/me/push-tokens { token, platform: "android" }` after login (when enabled in
 * Settings), `DELETE /users/me/push-tokens/:token` on logout / opt-out.
 *
 * NOTE (contract gap): the API currently delivers pushes through the Expo push service (ExpoPushProvider), which
 * only accepts Expo tokens. Native FCM tokens are stored but not delivered until the backend adds an FCM provider
 * (Firebase Admin SDK, HTTP v1). Without app/google-services.json Firebase is not initialised and this is a no-op.
 */
class PushManager(private val context: Context, private val api: ApiClient, private val settings: SettingsStore) {
    val isAvailable: Boolean get() = runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    fun hasPermission(): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    suspend fun registerIfEnabled() {
        if (!isAvailable || !settings.pushEnabled.first()) return
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return
        register(token)
    }

    suspend fun register(token: String) {
        runCatching { api.call { registerPushToken(PushTokenInput(token, "android")) } }
            .onSuccess { settings.setRegisteredPushToken(token) }
    }

    suspend fun unregister() {
        val token = settings.registeredPushToken() ?: return
        runCatching { api.call { deletePushToken(token) } }
        settings.setRegisteredPushToken(null)
    }

    companion object {
        const val CHANNEL_ID = "evtap_general"

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, context.getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_DEFAULT),
                )
            }
        }
    }
}

/** Receives FCM messages while the app is in the foreground (background "notification" messages are shown by FCM). */
class EvTapMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as? EvTapApp ?: return
        app.container.appScope.launch {
            if (app.container.session.isAuthed && app.container.settings.pushEnabled.first()) app.container.push.register(token)
        }
    }

    @SuppressLint("MissingPermission") // POST_NOTIFICATIONS is checked right before notify()
    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: message.data["body"] ?: return
        PushManager.ensureChannel(this)
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            // Same shape FCM uses when it shows a background notification itself: data keys as plain extras.
            message.data.forEach { (k, v) -> putExtra(k, v) }
        }
        val pending = PendingIntent.getActivity(
            this, message.messageId.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, PushManager.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            runCatching { NotificationManagerCompat.from(this).notify(message.messageId.hashCode(), notification) }
        }
        (application as? EvTapApp)?.container?.appScope?.launch { (application as EvTapApp).container.session.refreshMe() }
    }
}
