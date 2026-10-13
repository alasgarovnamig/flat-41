package az.evtap.core.markdown

/**
 * Minimal Markdown parser for CMS pages (GET /pages/:slug — body is Markdown): headings, paragraphs, bullet and
 * numbered lists, block quotes, horizontal rules and inline **bold**, *italic*, `code` and [links](url).
 * Produces a platform-neutral block tree; the app renders it with Compose text styles.
 */
sealed interface MdBlock {
    data class Heading(val level: Int, val inline: List<MdInline>) : MdBlock
    data class Paragraph(val inline: List<MdInline>) : MdBlock
    data class ListBlock(val ordered: Boolean, val items: List<List<MdInline>>) : MdBlock
    data class Quote(val inline: List<MdInline>) : MdBlock
    data object Rule : MdBlock
}

sealed interface MdInline {
    data class Text(val text: String, val bold: Boolean = false, val italic: Boolean = false, val code: Boolean = false) : MdInline
    data class Link(val text: String, val url: String) : MdInline
}

object Markdown {
    private val HEADING = Regex("""^(#{1,6})\s+(.*)$""")
    private val BULLET = Regex("""^\s*[-*+]\s+(.*)$""")
    private val NUMBERED = Regex("""^\s*\d+[.)]\s+(.*)$""")
    private val RULE = Regex("""^\s*([-*_])(\s*\1){2,}\s*$""")

    fun parse(src: String): List<MdBlock> {
        val out = ArrayList<MdBlock>()
        val para = StringBuilder()
        var list: Pair<Boolean, MutableList<String>>? = null
        val quote = StringBuilder()

        fun flushPara() {
            if (para.isNotBlank()) out.add(MdBlock.Paragraph(inline(para.toString().trim())))
            para.clear()
        }
        fun flushList() {
            list?.let { (ordered, items) -> out.add(MdBlock.ListBlock(ordered, items.map { inline(it) })) }
            list = null
        }
        fun flushQuote() {
            if (quote.isNotBlank()) out.add(MdBlock.Quote(inline(quote.toString().trim())))
            quote.clear()
        }
        fun flushAll() {
            flushPara(); flushList(); flushQuote()
        }

        for (raw in src.replace("\r\n", "\n").split('\n')) {
            val line = raw.trimEnd()
            when {
                line.isBlank() -> flushAll()
                RULE.matches(line) -> { flushAll(); out.add(MdBlock.Rule) }
                HEADING.matches(line) -> {
                    flushAll()
                    val m = HEADING.find(line)!!
                    out.add(MdBlock.Heading(m.groupValues[1].length, inline(m.groupValues[2].trim().trimEnd('#').trim())))
                }
                line.trimStart().startsWith(">") -> {
                    flushPara(); flushList()
                    if (quote.isNotEmpty()) quote.append(' ')
                    quote.append(line.trimStart().removePrefix(">").trim())
                }
                BULLET.matches(line) || NUMBERED.matches(line) -> {
                    flushPara(); flushQuote()
                    val ordered = !BULLET.matches(line)
                    val text = (if (ordered) NUMBERED else BULLET).find(line)!!.groupValues[1]
                    val current = list
                    if (current == null || current.first != ordered) {
                        flushList()
                        list = ordered to mutableListOf(text)
                    } else current.second.add(text)
                }
                list != null && raw.startsWith("  ") -> list!!.second.let { it[it.lastIndex] = it.last() + " " + line.trim() }
                else -> {
                    flushList(); flushQuote()
                    if (para.isNotEmpty()) para.append(' ')
                    para.append(line.trim())
                }
            }
        }
        flushAll()
        return out
    }

    /** Inline spans. Unclosed markers are kept as literal text. */
    fun inline(s: String): List<MdInline> {
        val out = ArrayList<MdInline>()
        val buf = StringBuilder()
        var bold = false
        var italic = false
        var i = 0
        fun flush() {
            if (buf.isNotEmpty()) out.add(MdInline.Text(buf.toString(), bold, italic))
            buf.clear()
        }
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\\' && i + 1 < s.length -> { buf.append(s[i + 1]); i += 2 }
                c == '`' -> {
                    val end = s.indexOf('`', i + 1)
                    if (end > i) { flush(); out.add(MdInline.Text(s.substring(i + 1, end), code = true)); i = end + 1 } else { buf.append(c); i++ }
                }
                c == '[' -> {
                    val close = s.indexOf(']', i + 1)
                    if (close > i && close + 1 < s.length && s[close + 1] == '(') {
                        val end = s.indexOf(')', close + 2)
                        if (end > close) {
                            flush()
                            out.add(MdInline.Link(s.substring(i + 1, close), s.substring(close + 2, end).trim()))
                            i = end + 1
                            continue
                        }
                    }
                    buf.append(c); i++
                }
                (c == '*' || c == '_') && i + 1 < s.length && s[i + 1] == c -> {
                    val marker = "$c$c"
                    if (bold || s.indexOf(marker, i + 2) > 0) { flush(); bold = !bold } else buf.append(marker)
                    i += 2
                }
                c == '*' || (c == '_' && (i == 0 || !s[i - 1].isLetterOrDigit())) || (c == '_' && italic) -> {
                    if (italic || s.indexOf(c, i + 1) > 0) { flush(); italic = !italic } else buf.append(c)
                    i++
                }
                else -> { buf.append(c); i++ }
            }
        }
        flush()
        return out
    }
}
