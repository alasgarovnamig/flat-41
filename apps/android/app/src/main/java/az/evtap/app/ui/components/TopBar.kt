package az.evtap.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvTheme

/**
 * Screen header: 44 dp circular back button, title, trailing circular actions. [large] adds the h1 title below
 * (mobile layout recipe: "large title + circular icon buttons").
 */
@Composable
fun EvTopBar(
    title: String?,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    large: Boolean = false,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (onBack != null) {
                IconCircleButton(EvIcons.ChevronLeft, stringResource(R.string.common_back), onBack, style = CircleStyle.Raised)
            } else Spacer(Modifier.width(4.dp))
            Box(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                if (!large && title != null) {
                    Text(title, style = EvTheme.type.h3, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
        if (large && title != null) {
            Text(
                title,
                style = EvTheme.type.h1,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = if (subtitle == null) 8.dp else 2.dp).semantics { heading() },
            )
        }
        if (subtitle != null) Text(subtitle, style = EvTheme.type.body, color = EvTheme.colors.muted, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
    }
}

/**
 * Standard screen scaffold: canvas background, top bar, content, optional bottom bar that stays above the
 * navigation bar / keyboard. Content receives padding for the bottom bar so nothing hides behind it.
 */
@Composable
fun EvScreen(
    modifier: Modifier = Modifier,
    topBar: @Composable () -> Unit = {},
    bottomBar: (@Composable () -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit,
) {
    androidx.compose.material3.Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = EvTheme.colors.canvas,
        contentColor = EvTheme.colors.ink,
        topBar = topBar,
        bottomBar = {
            if (bottomBar != null) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(EvTheme.colors.canvas.copy(alpha = 0.96f))
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                ) { bottomBar() }
            }
        },
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        content = content,
    )
}

/** Section title row: h3 title + optional "See all" ghost action. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = EvTheme.type.h3, modifier = Modifier.weight(1f).semantics { heading() })
        if (action != null && onAction != null) {
            PillButton(action, onAction, kind = PillKind.Ghost, size = PillSize.Small, trailingIcon = EvIcons.ArrowUpRight)
        }
    }
}
