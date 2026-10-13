import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, XSS-safe Markdown renderer for CMS pages (headings, paragraphs, lists, **bold**, *italic*, [links](url)).
 * HTML in the source is shown as text — never injected.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const safe = /^(https?:|mailto:|tel:|\/)/i.test(href!) ? href : '#';
      out.push(
        <a key={k} href={safe} className="font-medium text-brand underline-offset-2 hover:underline" rel={safe!.startsWith('http') ? 'noopener noreferrer' : undefined}>
          {label}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className="space-y-4 leading-relaxed text-ink/90">
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter((l) => l.trim() !== '');
        if (!lines.length) return null;
        const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]!);
        if (h && lines.length === 1) {
          const lvl = h[1]!.length;
          const cls = lvl === 1 ? 'text-2xl font-bold text-ink' : lvl === 2 ? 'mt-6 text-xl font-bold text-ink' : 'mt-4 text-lg font-semibold text-ink';
          return lvl <= 2 ? <h2 key={bi} className={cls}>{inline(h[2]!, `h${bi}`)}</h2> : <h3 key={bi} className={cls}>{inline(h[2]!, `h${bi}`)}</h3>;
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]!);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), `l${bi}-${li}`)}</li>);
          return ordered ? <ol key={bi} className="list-decimal space-y-1 pl-6">{items}</ol> : <ul key={bi} className="list-disc space-y-1 pl-6">{items}</ul>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#{1,4}\s+/, ''), `p${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
