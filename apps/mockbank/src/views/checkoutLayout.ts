import type { Translate } from '../lib/i18n';
import { LANGUAGE_NAMES } from '../lib/i18n';
import { LANGUAGES, type Language } from '../lib/types';
import { html, raw, type SafeHtml } from './html';

export interface PageContext {
  t: Translate;
  lang: Language;
  /** Explicit ?lang= chosen by the customer (kept across form posts). */
  langOverride: Language | null;
  isProd: boolean;
  /** Current path without query, for the language switcher. */
  path: string;
}

export function withLang(path: string, ctx: Pick<PageContext, 'langOverride'>): string {
  return ctx.langOverride ? `${path}?lang=${ctx.langOverride}` : path;
}

export const BANK_LOGO = raw(`<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0E7C66"/><path d="M16 6 6 11v2h20v-2L16 6Zm-7 9v8H7v3h18v-3h-2v-8h-3v8h-2.5v-8h-3v8H12v-8H9Z" fill="#fff"/></svg>`);
export const LOCK_ICON = raw(`<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>`);

const BASE_CSS = `
*{box-sizing:border-box}
:root{--navy:#0F2742;--navy-2:#163A5F;--primary:#0E7C66;--primary-dark:#0A5C4C;--text:#111827;--muted:#6B7280;--line:#E5E7EB;--surface:#F3F5F8;--danger:#D92D20;--danger-bg:#FEF3F2;--warn-bg:#FFF8E6;--warn:#8A5A00;--ok-bg:#ECFDF3;--ok:#067647}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--surface);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--primary)}
.topbar{background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff}
.topbar-inner{max-width:480px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.2px;font-size:16px}
.secure{display:flex;align-items:center;gap:4px;font-size:12px;opacity:.85;margin-left:auto}
.langs{display:flex;gap:2px;background:rgba(255,255,255,.12);border-radius:999px;padding:2px}
.langs a{color:#fff;text-decoration:none;font-size:11px;font-weight:600;padding:3px 7px;border-radius:999px;opacity:.75}
.langs a.on{background:#fff;color:var(--navy);opacity:1}
.testbar{background:#FFF4D6;color:#7A4E00;text-align:center;font-size:12px;font-weight:600;letter-spacing:.6px;padding:4px}
main{max-width:480px;margin:0 auto;padding:16px 12px 32px}
.card{background:#fff;border-radius:14px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.06);padding:20px}
.card+.card{margin-top:14px}
.summary{display:flex;align-items:center;gap:12px}
.avatar{width:44px;height:44px;border-radius:12px;background:#E6F4F1;color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex:none}
.summary .who{min-width:0;flex:1}
.summary .name{font-weight:600}
.summary .desc{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.summary .amount{font-size:20px;font-weight:700;white-space:nowrap}
.meta{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
label{display:block;font-size:13px;font-weight:600;color:#344054;margin:0 0 6px}
.field{margin-bottom:14px}
.input{width:100%;height:48px;border:1px solid #D0D5DD;border-radius:10px;padding:0 14px;font-size:16px;color:var(--text);background:#fff;outline:none;transition:border-color .15s,box-shadow .15s;font-family:inherit}
.input:focus{border-color:var(--primary);box-shadow:0 0 0 4px rgba(14,124,102,.14)}
.input.mono{font-variant-numeric:tabular-nums;letter-spacing:.5px}
.field.err .input{border-color:var(--danger)}
.field.err .input:focus{box-shadow:0 0 0 4px rgba(217,45,32,.12)}
.ferr{display:none;color:var(--danger);font-size:12px;margin-top:5px}
.field.err .ferr{display:block}
.row{display:flex;gap:12px}.row>.field{flex:1;min-width:0}
.with-badge{position:relative}
.badge{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:800;letter-spacing:.5px;padding:3px 7px;border-radius:6px;background:#F2F4F7;color:#475467;pointer-events:none}
.badge.VISA{background:#1A1F71;color:#fff}.badge.MASTERCARD{background:#EB001B;color:#fff}.badge.AMEX{background:#2E77BC;color:#fff}.badge.MAESTRO{background:#0099DF;color:#fff}.badge.UNIONPAY{background:#E21836;color:#fff}
.check{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:10px;margin-bottom:16px;cursor:pointer}
.check input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--primary);flex:none}
.check .hint{display:block;color:var(--muted);font-size:12px;font-weight:400;margin-top:2px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:50px;border:0;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit}
.btn-primary{background:var(--primary);color:#fff}.btn-primary:hover{background:var(--primary-dark)}
.btn-primary[disabled]{opacity:.7;cursor:progress}
.btn-ghost{background:transparent;color:#475467;height:44px;font-weight:500;margin-top:6px}.btn-ghost:hover{background:#F2F4F7}
.alert{border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:14px}
.alert-err{background:var(--danger-bg);color:#B42318}
.alert-info{background:#EFF8FF;color:#175CD3}
.alert-warn{background:var(--warn-bg);color:var(--warn)}
.note{display:flex;align-items:center;justify-content:center;gap:6px;color:var(--muted);font-size:12px;margin-top:14px;text-align:center}
.schemes{display:flex;justify-content:center;gap:6px;margin-top:10px}
.schemes span{font-size:10px;font-weight:800;padding:3px 6px;border-radius:4px;border:1px solid var(--line);color:#667085;letter-spacing:.4px}
.timer{font-variant-numeric:tabular-nums}
.tc summary{cursor:pointer;font-weight:600;list-style:none;display:flex;align-items:center;gap:8px}
.tc summary::-webkit-details-marker{display:none}
.tc summary:after{content:"▾";margin-left:auto;color:var(--muted)}
.tc[open] summary:after{content:"▴"}
.tc p{color:var(--muted);font-size:12px;margin:8px 0}
.tc table{width:100%;border-collapse:collapse;font-size:13px}
.tc td{padding:8px 4px;border-top:1px solid var(--line)}
.tc tr[data-pan]{cursor:pointer}.tc tr[data-pan]:hover td{background:#F9FAFB}
.tc .pan{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;white-space:nowrap}
.tag.ok{background:var(--ok-bg);color:var(--ok)}.tag.ds{background:#EFF8FF;color:#175CD3}.tag.no{background:var(--danger-bg);color:#B42318}
.center{text-align:center}
.footer{text-align:center;color:#98A2B3;font-size:11px;margin-top:18px}
@media (max-width:360px){.card{padding:16px}.summary .amount{font-size:18px}}
`;

export function checkoutLayout(ctx: PageContext, opts: { title: string; body: SafeHtml; head?: SafeHtml; showTopbar?: boolean }): SafeHtml {
  const { t, lang } = ctx;
  const langLinks = LANGUAGES.map(
    (l) => html`<a href="${ctx.path}?lang=${l}" class="${l === lang ? 'on' : ''}" hreflang="${l}">${LANGUAGE_NAMES[l]}</a>`,
  );
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0F2742">
<meta name="format-detection" content="telephone=no">
<title>${opts.title} · Mock Bank</title>
<style>${raw(BASE_CSS)}</style>
${opts.head}
</head>
<body>
${opts.showTopbar === false
    ? ''
    : html`<header class="topbar"><div class="topbar-inner">
  <div class="brand">${BANK_LOGO}<span>Mock Bank</span></div>
  <div class="secure">${LOCK_ICON}<span>${t('htmlTitle')}</span></div>
  <nav class="langs" aria-label="${t('language')}">${langLinks}</nav>
</div></header>`}
${ctx.isProd ? '' : html`<div class="testbar">${t('testMode')}</div>`}
${opts.body}
</body>
</html>`;
}
