package az.evtap.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvTheme

enum class PillKind { Primary, Secondary, Ghost, Outline, Destructive, Accent }
enum class PillSize(val height: Dp, val hPad: Dp) { Large(52.dp, 24.dp), Medium(44.dp, 20.dp), Small(36.dp, 14.dp) }

/**
 * The only button shape: a fully rounded pill. Primary = black pill / white text (inverted in dark mode),
 * Secondary = `pill` grey, Ghost = transparent, Destructive = danger on dangerBg. Small pills keep a 48 dp touch target.
 */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: PillKind = PillKind.Primary,
    size: PillSize = PillSize.Large,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val c = EvTheme.colors
    val (bg, fg) = when (kind) {
        PillKind.Primary -> c.ink to c.onInk
        PillKind.Secondary -> c.pill to c.ink
        PillKind.Ghost -> Color.Transparent to c.ink
        PillKind.Outline -> Color.Transparent to c.ink
        PillKind.Destructive -> c.dangerBg to c.danger
        PillKind.Accent -> c.accent to c.onAccent
    }
    val shape = RoundedCornerShape(50)
    Box(
        modifier
            .heightIn(min = maxOf(size.height, 48.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .defaultMinSize(minHeight = size.height)
                .clip(shape)
                .background(bg)
                .then(if (kind == PillKind.Outline) Modifier.border(BorderStroke(1.5.dp, c.ink), shape) else Modifier)
                .pressable(onClick = onClick, enabled = enabled && !loading)
                .alpha(if (enabled) 1f else 0.4f)
                .padding(horizontal = size.hPad),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(18.dp), color = fg, strokeWidth = 2.dp)
            } else if (icon != null) {
                Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
            }
            Text(
                text,
                style = if (size == PillSize.Small) EvTheme.type.label else EvTheme.type.bodyStrong,
                color = fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (trailingIcon != null && !loading) Icon(trailingIcon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
        }
    }
}

enum class CircleStyle { Sunken, Raised, Ink, Glass, Transparent }

/**
 * 44 dp circular icon button (48 dp touch target) — search, bell, settings, back, share, heart, ↗.
 * [contentDescription] is mandatory: icon-only controls need an accessible name.
 */
@Composable
fun IconCircleButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: CircleStyle = CircleStyle.Sunken,
    size: Dp = 44.dp,
    iconSize: Dp = 20.dp,
    tint: Color? = null,
    badge: Boolean = false,
    selected: Boolean? = null,
    enabled: Boolean = true,
) {
    val c = EvTheme.colors
    val (bg, fg) = when (style) {
        CircleStyle.Sunken -> c.surfaceSunken to c.ink
        CircleStyle.Raised -> c.surfaceRaised to c.ink
        CircleStyle.Ink -> c.ink to c.onInk
        CircleStyle.Glass -> (if (EvTheme.isDark) c.surfaceRaised.copy(alpha = 0.9f) else Color.White.copy(alpha = 0.9f)) to c.ink
        CircleStyle.Transparent -> Color.Transparent to c.ink
    }
    Box(modifier.size(maxOf(size, 48.dp)), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(bg)
                .pressable(onClick = onClick, enabled = enabled, role = Role.Button)
                .semantics {
                    this.contentDescription = contentDescription
                    if (selected != null) this.selected = selected
                }
                .alpha(if (enabled) 1f else 0.4f),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint ?: fg, modifier = Modifier.size(iconSize))
        }
        if (badge) {
            Box(
                Modifier
                    .align(Alignment.Center)
                    .offset(x = size / 2 - 8.dp, y = -(size / 2) + 8.dp)
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(c.danger)
                    .border(1.5.dp, bg.takeIf { it != Color.Transparent } ?: c.canvas, CircleShape),
            )
        }
    }
}

/** Black ↗ circle — the universal "open" affordance on cards. */
@Composable
fun OpenArrowButton(contentDescription: String, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 36.dp) =
    IconCircleButton(EvIcons.ArrowUpRight, contentDescription, onClick, modifier, CircleStyle.Ink, size = size, iconSize = 18.dp)

/** White heart circle on property photos. */
@Composable
fun HeartButton(favorite: Boolean, contentDescription: String, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 36.dp) =
    IconCircleButton(
        icon = if (favorite) EvIcons.HeartFilled else EvIcons.Heart,
        contentDescription = contentDescription,
        onClick = onClick,
        modifier = modifier,
        style = CircleStyle.Glass,
        size = size,
        iconSize = 18.dp,
        tint = if (favorite) EvTheme.colors.danger else null,
        selected = favorite,
    )
