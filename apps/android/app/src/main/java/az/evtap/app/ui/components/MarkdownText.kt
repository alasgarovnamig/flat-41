package az.evtap.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.markdown.Markdown
import az.evtap.core.markdown.MdBlock
import az.evtap.core.markdown.MdInline

/** Renders CMS Markdown (parsed in :core) with the design tokens. Links open via LinkAnnotation.Url. */
@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val blocks = remember(markdown) { Markdown.parse(markdown) }
    val c = EvTheme.colors
    val linkColor = c.ink
    val codeBg = c.surfaceSunken
    fun inline(spans: List<MdInline>): AnnotatedString = buildAnnotatedString {
        spans.forEach { s ->
            when (s) {
                is MdInline.Text -> withStyle(
                    SpanStyle(
                        fontWeight = if (s.bold) FontWeight.SemiBold else null,
                        fontStyle = if (s.italic) FontStyle.Italic else null,
                        fontFamily = if (s.code) FontFamily.Monospace else null,
                        background = if (s.code) codeBg else Color.Unspecified,
                    ),
                ) { append(s.text) }
                is MdInline.Link -> withLink(
                    LinkAnnotation.Url(s.url, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline, fontWeight = FontWeight.Medium))),
                ) { append(s.text) }
            }
        }
    }
    // readable measure on tablets
    Column(modifier.widthIn(max = 680.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        blocks.forEach { b ->
            when (b) {
                is MdBlock.Heading -> Text(
                    inline(b.inline),
                    style = when (b.level) { 1 -> EvTheme.type.h1; 2 -> EvTheme.type.h2; else -> EvTheme.type.h3 },
                    modifier = Modifier.padding(top = 8.dp).semantics { heading() },
                )
                is MdBlock.Paragraph -> Text(inline(b.inline), style = EvTheme.type.body, color = c.inkSecondary)
                is MdBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    b.items.forEachIndexed { i, item ->
                        Row {
                            Text(if (b.ordered) "${i + 1}." else "•", style = EvTheme.type.body, modifier = Modifier.width(24.dp))
                            Text(inline(item), style = EvTheme.type.body, color = c.inkSecondary)
                        }
                    }
                }
                is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(Modifier.width(3.dp).fillMaxHeight().background(c.accent))
                    Text(inline(b.inline), style = EvTheme.type.body.copy(fontStyle = FontStyle.Italic), color = c.inkSecondary, modifier = Modifier.padding(start = 12.dp))
                }
                MdBlock.Rule -> Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(c.hairline))
            }
        }
    }
}
