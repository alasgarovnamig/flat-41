package az.evtap.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import az.evtap.app.ui.theme.EvTheme
import kotlin.math.max

/**
 * BarcodeSpark — 24–32 thin vertical bars (2 dp, gap 3 dp). Historic bars are `subtle` and scaled to their value;
 * the last [highlight] bars are `ink` at full height, so the strip reads as a barcode. Decorative: the number next
 * to it carries the meaning, so it is hidden from accessibility unless [description] is given.
 */
@Composable
fun BarcodeSpark(
    values: List<Float>,
    modifier: Modifier = Modifier,
    highlight: Int = 8,
    barWidth: Dp = 2.dp,
    gap: Dp = 3.dp,
    height: Dp = 40.dp,
    description: String? = null,
) {
    val c = EvTheme.colors
    val bars = (if (values.isEmpty()) List(24) { 0f } else values).takeLast(32)
    val maxV = bars.maxOrNull()?.takeIf { it > 0f } ?: 1f
    Canvas(
        modifier
            .height(height)
            .width((barWidth + gap) * bars.size)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier.clearAndSetSemantics { }),
    ) {
        val bw = barWidth.toPx()
        val step = bw + gap.toPx()
        bars.forEachIndexed { i, v ->
            val hot = i >= bars.size - highlight
            val h = if (hot) size.height else max(size.height * 0.18f, size.height * 0.62f * (v / maxV))
            drawRoundRect(
                color = if (hot) c.ink else c.subtle,
                topLeft = Offset(i * step, size.height - h),
                size = Size(bw, h),
                cornerRadius = CornerRadius(bw / 2, bw / 2),
            )
        }
    }
}

/**
 * SplitMeter — two metrics side by side (e.g. Sale vs Rent): numbers on top, below a 16 dp pill track whose left part
 * is `ink`, right part `accent`, remainder hatched with 45° `subtle` stripes. Fractions are of the whole track.
 */
@Composable
fun SplitMeter(
    leftLabel: String,
    leftValue: AnnotatedString,
    rightLabel: String,
    rightValue: AnnotatedString,
    leftFraction: Float,
    rightFraction: Float,
    modifier: Modifier = Modifier,
) {
    val c = EvTheme.colors
    val lf = leftFraction.coerceIn(0f, 1f)
    val rf = rightFraction.coerceIn(0f, 1f - lf)
    Column(modifier.semantics(mergeDescendants = true) { }) {
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text(leftLabel, style = EvTheme.type.label, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(leftValue, style = EvTheme.type.number, maxLines = 1)
            }
            Box(Modifier.width(1.dp).height(52.dp).background(c.hairline))
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(rightLabel, style = EvTheme.type.label, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(rightValue, style = EvTheme.type.number, maxLines = 1)
            }
        }
        Spacer(Modifier.height(14.dp))
        Canvas(Modifier.fillMaxWidth().height(16.dp).clearAndSetSemantics { }) {
            val r = size.height / 2
            val track = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(r, r))) }
            clipPath(track) {
                // hatched remainder
                val stripe = 6.dp.toPx()
                var x = -size.height
                while (x < size.width + size.height) {
                    drawLine(c.subtle, Offset(x, size.height), Offset(x + size.height, 0f), strokeWidth = 1.2.dp.toPx())
                    x += stripe
                }
            }
            val lw = size.width * lf
            val rw = size.width * rf
            if (rw > 0f) drawRoundRect(c.accent, topLeft = Offset(max(0f, lw - r), 0f), size = Size(rw + if (lw > 0f) r else 0f, size.height), cornerRadius = CornerRadius(r, r))
            if (lw > 0f) drawRoundRect(c.ink, topLeft = Offset.Zero, size = Size(lw, size.height), cornerRadius = CornerRadius(r, r))
        }
    }
}

data class PillBar(val label: String, val value: Float, val tag: String? = null)

/**
 * PillBarChart — horizontal bars: white pill track with the value label inside on the left (12 sp); the filled part
 * ends in a black pill holding the delta tag. X axis in `muted` 11 sp, vertical `hairline` grid lines.
 */
@Composable
fun PillBarChart(
    bars: List<PillBar>,
    modifier: Modifier = Modifier,
    axis: List<String> = emptyList(),
    max: Float = bars.maxOfOrNull { it.value }?.takeIf { it > 0f } ?: 1f,
    description: String? = null,
) {
    val c = EvTheme.colors
    Column(modifier.then(if (description != null) Modifier.semantics(mergeDescendants = true) { contentDescription = description } else Modifier)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val full = maxWidth
            // grid
            if (axis.size > 1) {
                Canvas(Modifier.matchParentSize()) {
                    val n = axis.size - 1
                    for (i in 0..n) {
                        val x = size.width * i / n
                        drawLine(c.hairline, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1.dp.toPx())
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                bars.forEach { bar ->
                    val tagW = if (bar.tag != null) 56.dp else 0.dp
                    val fill = (full * (bar.value / max).coerceIn(0f, 1f)).coerceAtLeast(tagW + 72.dp).coerceAtMost(full)
                    Box(Modifier.width(fill).height(30.dp)) {
                        Box(
                            Modifier.matchParentSize().padding(end = tagW / 2).clip(RoundedCornerShape(50)).background(c.surfaceRaised),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            Text(bar.label, Modifier.padding(start = 12.dp, end = tagW / 2 + 4.dp), style = EvTheme.type.micro, color = c.inkSecondary, maxLines = 1)
                        }
                        if (bar.tag != null) {
                            Box(
                                Modifier.align(Alignment.CenterEnd).width(tagW).height(30.dp).clip(RoundedCornerShape(50)).background(c.ink),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(bar.tag, style = EvTheme.type.micro, color = c.onInk, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
        if (axis.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                axis.forEach { Text(it, style = EvTheme.type.micro, color = c.muted) }
            }
        }
    }
}

/** "+12%" / "−5%" change between the two halves of a series (null when there is no baseline). */
fun deltaPercent(series: List<Float>): String? {
    if (series.size < 2) return null
    val half = series.size / 2
    val before = series.take(half).sum()
    val after = series.drop(half).sum()
    if (before <= 0f) return null
    val pct = ((after - before) / before * 100).toInt()
    return if (pct >= 0) "+$pct%" else "−${-pct}%"
}
