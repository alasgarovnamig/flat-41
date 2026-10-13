package az.evtap.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme

/**
 * The very soft drop shadow of the reference (cards float a few px above the canvas).
 * Dark theme relies on surface steps instead of shadows.
 */
@Composable
fun Modifier.softShadow(shape: Shape, elevation: Dp = 14.dp): Modifier {
    val dark = EvTheme.isDark
    return if (dark) this else shadow(
        elevation = elevation,
        shape = shape,
        clip = false,
        ambientColor = Color.Black.copy(alpha = 0.05f),
        spotColor = Color.Black.copy(alpha = 0.10f),
    )
}

/** Press feedback: scale 0.98 over 150 ms (none when animations are off), plus a ripple. */
fun Modifier.pressable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
    bounded: Boolean = true,
): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val motion = EvTheme.motion
    val scale by animateFloatAsState(if (pressed && enabled) motion.pressScale else 1f, motion.fast(), label = "press")
    this
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(
            interactionSource = interaction,
            indication = ripple(bounded = bounded, color = EvTheme.colors.ink),
            enabled = enabled,
            role = role,
            onClickLabel = onClickLabel,
            onClick = onClick,
        )
}

/**
 * Frosted card: `surface` colour, 28 dp radius, inner white highlight + very soft shadow (DESIGN_SYSTEM "Card").
 */
@Composable
fun EvCard(
    modifier: Modifier = Modifier,
    color: Color = EvTheme.colors.surface,
    radius: Dp = EvRadius.xl,
    contentPadding: PaddingValues = PaddingValues(20.dp),
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(radius)
    val c = EvTheme.colors
    Column(
        modifier
            .softShadow(shape)
            .clip(shape)
            .background(color)
            .border(BorderStroke(1.dp, if (EvTheme.isDark) c.hairline else Color.White.copy(alpha = 0.75f)), shape)
            .then(if (onClick != null) Modifier.pressable(onClick, onClickLabel = onClickLabel) else Modifier)
            .padding(contentPadding),
        content = content,
    )
}

/** White ("raised") panel — inputs, popovers, property card bodies. */
@Composable
fun RaisedCard(
    modifier: Modifier = Modifier,
    radius: Dp = EvRadius.lg,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) = EvCard(modifier, EvTheme.colors.surfaceRaised, radius, contentPadding, onClick, content = content)

/** Glass layer for floating bars / overlays: translucent white + bright border (no platform blur needed). */
@Composable
fun Modifier.glass(shape: Shape): Modifier {
    val c = EvTheme.colors
    return this
        .softShadow(shape, 18.dp)
        .clip(shape)
        .background(if (EvTheme.isDark) c.surfaceRaised.copy(alpha = 0.92f) else Color.White.copy(alpha = 0.86f))
        .border(1.dp, c.glassBorder, shape)
}

@Composable
fun HairlineDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(EvTheme.colors.hairline))
}

/** Section wrapper with the standard 20 dp page gutter. */
@Composable
fun PageSection(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp), content = content)
}
