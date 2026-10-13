// GENERATED from packages/design-tokens/tokens.json — do not edit (pnpm --filter @evtap/design-tokens build)
package az.evtap.app.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Immutable
data class EvColors(
    val canvas: Color,
    val frame: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val surfaceSunken: Color,
    val pill: Color,
    val pillHover: Color,
    val ink: Color,
    val inkSecondary: Color,
    val muted: Color,
    val subtle: Color,
    val hairline: Color,
    val onInk: Color,
    val accent: Color,
    val accentStrong: Color,
    val star: Color,
    val success: Color,
    val successBg: Color,
    val warning: Color,
    val warningBg: Color,
    val danger: Color,
    val dangerBg: Color,
    val info: Color,
    val infoBg: Color,
    val vip: Color,
    val vipBg: Color,
    val premium: Color,
    val highlightBg: Color,
    val glass: Color,
    val glassBorder: Color,
    val scrim: Color,
)

val EvLightColors = EvColors(
    canvas = Color(0xFFE9E9EB),
    frame = Color(0xFFF2F2F3),
    surface = Color(0xFFF6F6F7),
    surfaceRaised = Color(0xFFFFFFFF),
    surfaceSunken = Color(0xFFECECEE),
    pill = Color(0xFFE2E2E5),
    pillHover = Color(0xFFD8D8DC),
    ink = Color(0xFF0B0B0C),
    inkSecondary = Color(0xFF3A3A3C),
    muted = Color(0xFF8E8E93),
    subtle = Color(0xFFB9B9BE),
    hairline = Color(0xFFDEDEE2),
    onInk = Color(0xFFFFFFFF),
    accent = Color(0xFFF2C49B),
    accentStrong = Color(0xFFE8955A),
    star = Color(0xFFF26B1D),
    success = Color(0xFF2F7D1E),
    successBg = Color(0xFFD8F5CA),
    warning = Color(0xFFA35A06),
    warningBg = Color(0xFFFFEBCC),
    danger = Color(0xFFC2362B),
    dangerBg = Color(0xFFFFDCD8),
    info = Color(0xFF2B5FA8),
    infoBg = Color(0xFFDCE8FA),
    vip = Color(0xFFC9962B),
    vipBg = Color(0xFFFFF1D2),
    premium = Color(0xFF0B0B0C),
    highlightBg = Color(0xFFFFF6EC),
    glass = Color(0x94FFFFFF),
    glassBorder = Color(0xBFFFFFFF),
    scrim = Color(0x730B0B0C),
)

val EvDarkColors = EvColors(
    canvas = Color(0xFF0C0C0E),
    frame = Color(0xFF121215),
    surface = Color(0xFF18181B),
    surfaceRaised = Color(0xFF202024),
    surfaceSunken = Color(0xFF141417),
    pill = Color(0xFF26262B),
    pillHover = Color(0xFF303036),
    ink = Color(0xFFF5F5F7),
    inkSecondary = Color(0xFFD1D1D6),
    muted = Color(0xFF9A9AA0),
    subtle = Color(0xFF5E5E66),
    hairline = Color(0xFF2C2C32),
    onInk = Color(0xFF0B0B0C),
    accent = Color(0xFFE9B88C),
    accentStrong = Color(0xFFF0A06A),
    star = Color(0xFFFF8A3D),
    success = Color(0xFF7DDB62),
    successBg = Color(0xFF1E3A16),
    warning = Color(0xFFF5B451),
    warningBg = Color(0xFF3D2A0C),
    danger = Color(0xFFFF7B70),
    dangerBg = Color(0xFF3F1714),
    info = Color(0xFF7FB0F5),
    infoBg = Color(0xFF16263F),
    vip = Color(0xFFE6BC5C),
    vipBg = Color(0xFF3A2D10),
    premium = Color(0xFFF5F5F7),
    highlightBg = Color(0xFF2A2118),
    glass = Color(0x99202024),
    glassBorder = Color(0x14FFFFFF),
    scrim = Color(0x99000000),
)

object EvRadius {
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val lg = 22.dp
    val xl = 28.dp
    val frame = 36.dp
    val pill = 999.dp
}

object EvSpace {
    val s1 = 4.dp
    val s2 = 8.dp
    val s3 = 12.dp
    val s4 = 16.dp
    val s5 = 20.dp
    val s6 = 24.dp
    val s8 = 32.dp
    val s10 = 40.dp
    val s12 = 48.dp
    val s16 = 64.dp
}

data class EvTextSpec(val size: Float, val line: Float, val weight: Int, val display: Boolean, val tracking: Float)

object EvTypeSpec {
    val display = EvTextSpec(44f, 48f, 400, true, -1.2f)
    val h1 = EvTextSpec(32f, 38f, 500, true, -0.6f)
    val h2 = EvTextSpec(24f, 30f, 500, true, -0.4f)
    val h3 = EvTextSpec(19f, 24f, 500, true, -0.2f)
    val number = EvTextSpec(30f, 34f, 400, true, -0.8f)
    val body = EvTextSpec(15f, 22f, 400, false, 0f)
    val bodyStrong = EvTextSpec(15f, 22f, 500, false, 0f)
    val label = EvTextSpec(13f, 18f, 500, false, 0f)
    val caption = EvTextSpec(12f, 16f, 400, false, 0.1f)
}
