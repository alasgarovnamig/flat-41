package az.evtap.app.ui.theme

import android.content.Context
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import az.evtap.app.R
import androidx.compose.ui.text.font.Font as ComposeFont

/**
 * Typography from the design tokens (EvTypeSpec): Outfit for display / big numbers, Inter for UI text.
 *
 * Outfit has no "ə/Ə", "₼" or Cyrillic glyphs — essential for az/ru. On API 29+ the display family is therefore
 * built with [Typeface.CustomFallbackBuilder] so missing glyphs come from Inter (same metrics family feel) instead of
 * the system font; on API 26–28 the platform falls back to the system sans-serif for those characters.
 */
@Immutable
data class EvTypography(
    val display: TextStyle,
    val h1: TextStyle,
    val h2: TextStyle,
    val h3: TextStyle,
    val number: TextStyle,
    val body: TextStyle,
    val bodyStrong: TextStyle,
    val label: TextStyle,
    val caption: TextStyle,
    /** 11 sp chip / axis text (spec chips, chart axis, pill tags). */
    val micro: TextStyle,
)

private fun interFont(weight: FontWeight) =
    ComposeFont(R.font.inter, weight = weight, variationSettings = FontVariation.Settings(weight, FontStyle.Normal))

private fun outfitFont(weight: FontWeight) =
    ComposeFont(R.font.outfit, weight = weight, variationSettings = FontVariation.Settings(weight, FontStyle.Normal))

val InterFamily: FontFamily = FontFamily(
    interFont(FontWeight.Normal),
    interFont(FontWeight.Medium),
    interFont(FontWeight.SemiBold),
    interFont(FontWeight.Bold),
)

private val OutfitResourceFamily: FontFamily = FontFamily(
    outfitFont(FontWeight.Light),
    outfitFont(FontWeight.Normal),
    outfitFont(FontWeight.Medium),
)

/** Outfit at one weight with Inter → system fallback for missing glyphs (API 29+). */
private fun outfitWithFallback(context: Context, weight: Int): FontFamily? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    return runCatching {
        val res = context.resources
        val outfit = Font.Builder(res, R.font.outfit).setWeight(weight).setFontVariationSettings("'wght' $weight").build()
        val inter = Font.Builder(res, R.font.inter).setWeight(weight).setFontVariationSettings("'wght' $weight").build()
        val typeface = Typeface.CustomFallbackBuilder(android.graphics.fonts.FontFamily.Builder(outfit).build())
            .addCustomFallback(android.graphics.fonts.FontFamily.Builder(inter).build())
            .setSystemFallback("sans-serif")
            .setStyle(android.graphics.fonts.FontStyle(weight, android.graphics.fonts.FontStyle.FONT_SLANT_UPRIGHT))
            .build()
        FontFamily(typeface)
    }.getOrNull()
}

private fun style(spec: EvTextSpec, family: FontFamily) = TextStyle(
    fontFamily = family,
    fontWeight = FontWeight(spec.weight),
    fontSize = spec.size.sp,
    lineHeight = spec.line.sp,
    letterSpacing = (spec.tracking / spec.size).em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

@Composable
fun rememberEvTypography(): EvTypography {
    val context = LocalContext.current
    return remember(context) {
        val display400 = outfitWithFallback(context, 400) ?: OutfitResourceFamily
        val display500 = outfitWithFallback(context, 500) ?: OutfitResourceFamily
        fun display(spec: EvTextSpec) = style(spec, if (spec.weight >= 500) display500 else display400)
        EvTypography(
            display = display(EvTypeSpec.display),
            h1 = display(EvTypeSpec.h1),
            h2 = display(EvTypeSpec.h2),
            h3 = display(EvTypeSpec.h3),
            number = display(EvTypeSpec.number),
            body = style(EvTypeSpec.body, InterFamily),
            bodyStrong = style(EvTypeSpec.bodyStrong, InterFamily),
            label = style(EvTypeSpec.label, InterFamily),
            caption = style(EvTypeSpec.caption, InterFamily),
            micro = style(EvTextSpec(11f, 14f, 500, false, 0.1f), InterFamily),
        )
    }
}
