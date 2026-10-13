package az.evtap.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import az.evtap.app.ui.common.imageUrl
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvTheme
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.painter.ColorPainter
import coil3.compose.AsyncImage

/**
 * Network image with a token-coloured placeholder of the final size (no layout shift) and a line-icon fallback.
 * Relative upload paths are resolved against the API origin.
 */
@Composable
fun EvImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    fallbackIcon: ImageVector = EvIcons.Home,
) {
    val resolved = imageUrl(url)
    val c = EvTheme.colors
    if (resolved == null) {
        Box(modifier.background(c.surfaceSunken), contentAlignment = Alignment.Center) {
            Icon(fallbackIcon, contentDescription, tint = c.subtle, modifier = Modifier.size(36.dp))
        }
        return
    }
    // AsyncImage (not SubcomposeAsyncImage): no subcomposition per item, cheap inside lazy lists.
    val placeholder = remember(c.surfaceSunken) { ColorPainter(c.surfaceSunken) }
    AsyncImage(
        model = resolved,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
        placeholder = placeholder,
        error = placeholder,
        fallback = placeholder,
    )
}

@Composable
fun Avatar(url: String?, name: String, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    val c = EvTheme.colors
    if (url.isNullOrBlank()) {
        Box(modifier.size(size).clip(CircleShape).background(c.ink), contentAlignment = Alignment.Center) {
            Text(
                name.trim().split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }.ifEmpty { "?" },
                style = if (size >= 56.dp) EvTheme.type.h3 else EvTheme.type.label,
                color = c.onInk,
            )
        }
    } else {
        EvImage(url, name, modifier.size(size).clip(CircleShape), fallbackIcon = EvIcons.User)
    }
}
