package az.evtap.app.platform

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import az.evtap.core.model.AppLocale
import java.util.Locale

/**
 * Per-app language (Android 13+ system API, AppCompat back-port below). The choice survives restarts; the activity
 * is recreated with the new resources automatically.
 */
object AppLanguage {
    /** The language the UI is shown in right now (per-app setting, else the system language, else az). */
    fun current(): AppLocale {
        val app = AppCompatDelegate.getApplicationLocales()
        val tag = if (!app.isEmpty) app[0]?.language else Locale.getDefault().language
        return AppLocale.entries.firstOrNull { it.tag == tag } ?: AppLocale.DEFAULT
    }

    /** True when the user picked a language in the app (otherwise we follow the system). */
    fun isExplicit(): Boolean = !AppCompatDelegate.getApplicationLocales().isEmpty

    fun set(locale: AppLocale) {
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(locale.tag))
    }

    /** java.util.Locale for date/number formatting in the chosen language. */
    fun javaLocale(locale: AppLocale = current()): Locale = Locale.forLanguageTag(locale.tag)
}
