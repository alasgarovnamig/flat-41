package az.evtap.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.theme.EvTheme

/**
 * StatCard: Card + title (19 sp) + optional ↗ (white 36 dp circle) + big number + caption + BarcodeSpark
 * right-aligned (reference "Total Revenue / Completed Deals").
 */
@Composable
fun StatCard(
    title: String,
    value: AnnotatedString,
    caption: String?,
    modifier: Modifier = Modifier,
    spark: List<Float> = emptyList(),
    onOpen: (() -> Unit)? = null,
    tag: String? = null,
) {
    EvCard(modifier, contentPadding = PaddingValues(18.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Text(title, style = EvTheme.type.h3, modifier = Modifier.weight(1f).semantics { heading() }, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (onOpen != null) IconCircleButton(az.evtap.app.ui.icons.EvIcons.ArrowUpRight, stringResource(R.string.common_more) + ": " + title, onOpen, style = CircleStyle.Raised, size = 36.dp, iconSize = 16.dp)
        }
        Spacer(Modifier.heightIn(min = 18.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (tag != null) DeltaTag(tag)
                Text(value, style = EvTheme.type.number, maxLines = 1)
                if (caption != null) Text(caption, style = EvTheme.type.caption, color = EvTheme.colors.muted, maxLines = 1)
            }
            if (spark.isNotEmpty()) BarcodeSpark(spark, height = 38.dp)
        }
    }
}

/** Small metric tile for 2-column grids (views / calls / favourites). */
@Composable
fun MetricTile(label: String, value: String, modifier: Modifier = Modifier) {
    EvCard(modifier, contentPadding = PaddingValues(16.dp)) {
        Text(label, style = EvTheme.type.label, color = EvTheme.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(6.dp))
        Text(value, style = EvTheme.type.number, maxLines = 1)
    }
}
