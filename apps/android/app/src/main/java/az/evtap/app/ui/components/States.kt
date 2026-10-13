package az.evtap.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.common.UiText
import az.evtap.app.ui.common.asString
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvTheme

/** Thin-line icon in a 72 dp circle + title + body + black pill CTA. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val c = EvTheme.colors
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(c.surfaceSunken), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.inkSecondary, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(4.dp))
        Text(title, style = EvTheme.type.h3, textAlign = TextAlign.Center)
        if (body != null) Text(body, style = EvTheme.type.body, color = c.muted, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(6.dp))
            PillButton(actionLabel, onAction, size = PillSize.Medium)
        }
    }
}

@Composable
fun ErrorState(error: UiText, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    EmptyState(
        icon = EvIcons.AlertCircle,
        title = stringResource(R.string.common_error_title),
        body = error.asString(),
        actionLabel = onRetry?.let { stringResource(R.string.common_retry) },
        onAction = onRetry,
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().padding(40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = EvTheme.colors.ink, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
fun LoadingFooter() {
    Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = EvTheme.colors.ink, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
    }
}

/** Placeholder block with the final content's radius; pulses gently unless animations are off. */
@Composable
fun Skeleton(modifier: Modifier = Modifier, radius: Dp = 12.dp) {
    val c = EvTheme.colors
    val alpha = if (EvTheme.motion.reduced) 1f else {
        val t = rememberInfiniteTransition(label = "skeleton")
        val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
        a
    }
    Box(modifier.clip(RoundedCornerShape(radius)).alpha(alpha).background(c.surfaceSunken).clearAndSetSemantics { })
}

@Composable
fun PropertyCardSkeleton(modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Skeleton(Modifier.fillMaxWidth().height(200.dp), radius = 22.dp)
        Skeleton(Modifier.fillMaxWidth(0.7f).height(16.dp))
        Skeleton(Modifier.fillMaxWidth(0.4f).height(14.dp))
    }
}
