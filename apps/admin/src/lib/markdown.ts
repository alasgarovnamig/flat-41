/**
 * Tiny, safe markdown → HTML renderer for the CMS preview (headings, paragraphs, lists, quotes,
 * bold/italic/code, links). All input is HTML-escaped first; links are restricted to http(s)/mailto/relative.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) =>
      /^(https?:\/\/|mailto:|\/)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text,
    );

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara();
      closeList();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}
