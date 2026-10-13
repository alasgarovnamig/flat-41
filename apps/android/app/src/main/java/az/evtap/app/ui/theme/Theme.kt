package az.evtap.app.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalContext

/** Theme preference stored in Settings (system / light / dark). */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** Motion tokens; collapse to `snap()` when the user disabled animations (animator duration scale = 0). */
@Immutable
data class EvMotion(val reduced: Boolean) {
    fun <T> fast(): FiniteAnimationSpec<T> = if (reduced) snap() else tween(150, easing = FastOutSlowInEasing)
    fun <T> standard(): FiniteAnimationSpec<T> = if (reduced) snap() else tween(250, easing = FastOutSlowInEasing)
    fun <T> slow(): FiniteAnimationSpec<T> = if (reduced) snap() else tween(400, easing = FastOutSlowInEasing)
    /** Press feedback scale (design: 0.98); 1 when motion is reduced. */
    val pressScale: Float get() = if (reduced) 1f else 0.98f
}

val LocalEvColors = staticCompositionLocalOf { EvLightColors }
val LocalEvTypography = staticCompositionLocalOf<EvTypography> { error("EvTapTheme not set") }
val LocalEvMotion = staticCompositionLocalOf { EvMotion(reduced = false) }
val LocalIsDark = staticCompositionLocalOf { false }

/** Accessors: `EvTheme.colors.ink`, `EvTheme.type.h2`, `EvTheme.motion.standard()`. */
object EvTheme {
    val colors: EvColors @Composable @ReadOnlyComposable get() = LocalEvColors.current
    val type: EvTypography @Composable @ReadOnlyComposable get() = LocalEvTypography.current
    val motion: EvMotion @Composable @ReadOnlyComposable get() = LocalEvMotion.current
    val isDark: Boolean @Composable @ReadOnlyComposable get() = LocalIsDark.current
}

/**
 * EvTap "Soft Monochrome" theme. Material 3 is kept underneath only so stock components (text selection, ripples,
 * date/time pickers, dialogs) inherit token colours; every visible component is an EvTap component.
 */
@Composable
fun EvTapTheme(mode: ThemeMode = ThemeMode.SYSTEM, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val c = if (dark) EvDarkColors else EvLightColors
    val type = rememberEvTypography()
    val context = LocalContext.current
    val reduced = remember(context) {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
    val scheme = remember(c, dark) {
        val base = if (dark) darkColorScheme() else lightColorScheme()
        base.copy(
            primary = c.ink, onPrimary = c.onInk, primaryContainer = c.pill, onPrimaryContainer = c.ink,
            secondary = c.inkSecondary, onSecondary = c.onInk, secondaryContainer = c.pill, onSecondaryContainer = c.ink,
            tertiary = c.accentStrong, onTertiary = c.ink, tertiaryContainer = c.accent, onTertiaryContainer = c.onAccent,
            background = c.canvas, onBackground = c.ink, surface = c.surfaceRaised, onSurface = c.ink,
            surfaceVariant = c.surfaceSunken, onSurfaceVariant = c.inkSecondary, surfaceTint = c.ink,
            surfaceContainerLowest = c.surfaceRaised, surfaceContainerLow = c.surface, surfaceContainer = c.surface,
            surfaceContainerHigh = c.surfaceRaised, surfaceContainerHighest = c.pill,
            outline = c.hairline, outlineVariant = c.hairline, error = c.danger, onError = c.onInk,
            errorContainer = c.dangerBg, onErrorContainer = c.danger, scrim = c.scrim, inverseSurface = c.ink, inverseOnSurface = c.onInk,
        )
    }
    val m3Type = remember(type) {
        Typography(
            displayLarge = type.display, displayMedium = type.h1, displaySmall = type.h2,
            headlineLarge = type.h1, headlineMedium = type.h2, headlineSmall = type.h3,
            titleLarge = type.h3, titleMedium = type.bodyStrong, titleSmall = type.label,
            bodyLarge = type.body, bodyMedium = type.body, bodySmall = type.caption,
            labelLarge = type.label, labelMedium = type.caption, labelSmall = type.micro,
        )
    }
    val shapes = remember {
        Shapes(
            extraSmall = RoundedCornerShape(EvRadius.xs), small = RoundedCornerShape(EvRadius.sm), medium = RoundedCornerShape(EvRadius.md),
            large = RoundedCornerShape(EvRadius.lg), extraLarge = RoundedCornerShape(EvRadius.xl),
        )
    }
    CompositionLocalProvider(
        LocalEvColors provides c,
        LocalEvTypography provides type,
        LocalEvMotion provides EvMotion(reduced),
        LocalIsDark provides dark,
    ) {
        MaterialTheme(colorScheme = scheme, typography = m3Type, shapes = shapes) {
            CompositionLocalProvider(
                LocalContentColor provides c.ink,
                LocalTextSelectionColors provides TextSelectionColors(handleColor = c.ink, backgroundColor = c.accent.copy(alpha = 0.5f)),
                content = content,
            )
        }
    }
}
