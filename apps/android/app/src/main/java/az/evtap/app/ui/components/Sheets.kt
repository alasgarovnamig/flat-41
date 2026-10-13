package az.evtap.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import az.evtap.app.R
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme

/**
 * Bottom sheet: `surfaceRaised`, 28 dp top radius, measured scrim, glass-style header with a close button and an
 * optional sticky [footer] (primary actions stay reachable above the keyboard).
 */
@Composable
fun EvBottomSheet(
    onDismiss: () -> Unit,
    title: String? = null,
    footer: (@Composable () -> Unit)? = null,
    scrollable: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = EvTheme.colors
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        shape = RoundedCornerShape(topStart = EvRadius.xl, topEnd = EvRadius.xl),
        containerColor = c.surfaceRaised,
        contentColor = c.ink,
        scrimColor = c.scrim,
        dragHandle = {
            Box(Modifier.padding(top = 10.dp, bottom = 4.dp).width(40.dp).height(4.dp).clip(RoundedCornerShape(50)).background(c.hairline))
        },
    ) {
        Column(Modifier.fillMaxWidth()) {
            if (title != null) {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = EvTheme.type.h3, modifier = Modifier.weight(1f).semantics { heading() })
                    IconCircleButton(EvIcons.Close, stringResource(R.string.common_close), onDismiss, style = CircleStyle.Sunken, size = 40.dp, iconSize = 18.dp)
                }
            }
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .then(if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                content = content,
            )
            if (footer != null) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) { footer() }
            }
            Box(Modifier.navigationBarsPadding())
        }
    }
}

data class SheetAction(val label: String, val destructive: Boolean = false, val selected: Boolean = false, val onClick: () -> Unit)

/** List of actions (sort order, listing actions…). */
@Composable
fun ActionSheet(title: String?, actions: List<SheetAction>, onDismiss: () -> Unit) {
    EvBottomSheet(onDismiss = onDismiss, title = title) {
        actions.forEach { a ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .clip(RoundedCornerShape(EvRadius.md))
                    .pressable({ onDismiss(); a.onClick() })
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    a.label,
                    style = if (a.selected) EvTheme.type.bodyStrong else EvTheme.type.body,
                    color = if (a.destructive) EvTheme.colors.danger else EvTheme.colors.ink,
                    modifier = Modifier.weight(1f),
                )
                if (a.selected) androidx.compose.material3.Icon(EvIcons.Check, null, tint = EvTheme.colors.ink)
            }
        }
    }
}

/** Single / multi option picker in a sheet (city, district, metro…). */
@Composable
fun <T> OptionSheet(
    title: String,
    options: List<Pair<T, String>>,
    selected: Set<T>,
    multiple: Boolean,
    onDismiss: () -> Unit,
    onSelect: (Set<T>) -> Unit,
    clearLabel: String? = null,
) {
    var current = selected
    EvBottomSheet(
        onDismiss = onDismiss,
        title = title,
        footer = if (multiple) {
            {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PillButton(stringResource(R.string.common_reset), { onSelect(emptySet()); onDismiss() }, Modifier.weight(1f), kind = PillKind.Secondary)
                    PillButton(stringResource(R.string.common_done), onDismiss, Modifier.weight(1f))
                }
            }
        } else null,
    ) {
        if (!multiple && clearLabel != null) {
            RadioRow(clearLabel, selected.isEmpty(), { onSelect(emptySet()); onDismiss() })
        }
        options.forEach { (value, label) ->
            if (multiple) {
                CheckRow(label, value in current, {
                    current = if (value in current) current - value else current + value
                    onSelect(current)
                })
            } else {
                RadioRow(label, value in selected, { onSelect(setOf(value)); onDismiss() })
            }
        }
    }
}

/** Confirmation dialog in the card style; destructive confirmations use the danger pill. */
@Composable
fun ConfirmDialog(
    title: String,
    text: String?,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Dialog(onDismissRequest = onDismiss) {
        EvCard(color = EvTheme.colors.surfaceRaised, contentPadding = androidx.compose.foundation.layout.PaddingValues(24.dp)) {
            Text(title, style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
            if (text != null) Text(text, style = EvTheme.type.body, color = EvTheme.colors.inkSecondary, modifier = Modifier.padding(top = 8.dp))
            if (content != null) Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.common_cancel), onDismiss, Modifier.weight(1f), kind = PillKind.Secondary, size = PillSize.Medium)
                PillButton(
                    confirmLabel,
                    { onConfirm(); onDismiss() },
                    Modifier.weight(1f),
                    kind = if (destructive) PillKind.Destructive else PillKind.Primary,
                    size = PillSize.Medium,
                )
            }
        }
    }
}

/** Gentle explanatory banner (info / warning). */
@Composable
fun NoticeBanner(text: String, modifier: Modifier = Modifier, tone: NoticeTone = NoticeTone.Info) {
    val c = EvTheme.colors
    val (bg, fg) = when (tone) {
        NoticeTone.Info -> c.infoBg to c.info
        NoticeTone.Warning -> c.warningBg to c.warning
        NoticeTone.Success -> c.successBg to c.success
        NoticeTone.Danger -> c.dangerBg to c.danger
        NoticeTone.Highlight -> c.highlightBg to c.ink
    }
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(EvRadius.md)).background(bg).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        androidx.compose.material3.Icon(EvIcons.Info, null, tint = fg, modifier = Modifier.padding(top = 1.dp))
        Text(text, style = EvTheme.type.body, color = if (tone == NoticeTone.Highlight) c.ink else fg, textAlign = TextAlign.Start)
    }
}

enum class NoticeTone { Info, Warning, Success, Danger, Highlight }
