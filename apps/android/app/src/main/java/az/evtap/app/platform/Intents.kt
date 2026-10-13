package az.evtap.app.platform

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import az.evtap.app.R
import az.evtap.core.format.Format

/** Thin wrappers around system intents; every call is safe when no app can handle it. */
object Intents {
    private fun Context.startSafely(intent: Intent): Boolean = try {
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        false
    }

    fun dial(context: Context, phone: String) = context.startSafely(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")))

    fun whatsapp(context: Context, phone: String, text: String) =
        context.startSafely(Intent(Intent.ACTION_VIEW, Uri.parse(Format.whatsappUrl(phone, text))))

    fun share(context: Context, title: String, text: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TEXT, text)
        }
        context.startSafely(Intent.createChooser(send, context.getString(R.string.common_share)))
    }

    fun email(context: Context, to: String) = context.startSafely(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$to")))

    fun openBrowser(context: Context, url: String) = context.startSafely(Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    /** Chrome Custom Tab in the app's colours (bank checkout, external banners); falls back to any browser. */
    fun customTab(context: Context, url: String, toolbarColor: Int, dark: Boolean) {
        val params = CustomTabColorSchemeParams.Builder().setToolbarColor(toolbarColor).build()
        val intent = CustomTabsIntent.Builder()
            .setDefaultColorSchemeParams(params)
            .setColorScheme(if (dark) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT)
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .build()
        try {
            intent.launchUrl(context, Uri.parse(url))
        } catch (e: ActivityNotFoundException) {
            openBrowser(context, url)
        }
    }

    fun appSettings(context: Context) = context.startSafely(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
    )
}
