import type { OrderListFilter } from '../services/orders';
import type { MerchantStats } from '../services/merchants';
import { eventForStatus } from '../services/orderStore';
import type { DeliveryRow, WebhookRow } from '../services/webhooks';
import type { CardTokenRow, Merchant, OrderJson, OrderRow, OrderStatus, RefundRow } from '../lib/types';
import { ORDER_STATUSES } from '../lib/types';
import { formatMoney } from '../lib/util';
import { BANK_LOGO } from './checkoutLayout';
import { formatDateTime, html, raw, type SafeHtml } from './html';

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F3F5F8;color:#111827;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif}
a{color:#0E7C66;text-decoration:none}a:hover{text-decoration:underline}
header{background:linear-gradient(135deg,#0F2742,#163A5F);color:#fff}
.hin{max-width:1280px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px;color:#fff}
.logo small{font-weight:500;opacity:.7;font-size:12px}
nav a{color:#fff;opacity:.75;margin-right:16px;font-weight:500}nav a.on,nav a:hover{opacity:1;text-decoration:none}
main{max-width:1280px;margin:0 auto;padding:20px}
h1{font-size:20px;margin:0 0 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
h2{font-size:15px;margin:0 0 10px}
.panel{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(16,24,40,.06);padding:16px;margin-bottom:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:12px;color:#667085;font-weight:600;padding:8px 10px;border-bottom:1px solid #E4E7EC;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid #F2F4F7;vertical-align:top}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#FAFBFC}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:#667085}
.nowrap{white-space:nowrap}
.b{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;letter-spacing:.3px;white-space:nowrap}
.s-CREATED{background:#F2F4F7;color:#344054}.s-PROCESSING{background:#EFF8FF;color:#175CD3}.s-APPROVED{background:#ECFDF3;color:#067647}
.s-DECLINED{background:#FEF3F2;color:#B42318}.s-CANCELLED{background:#E4E7EC;color:#344054}.s-EXPIRED{background:#FFF8E6;color:#8A5A00}
.s-REFUNDED{background:#F4F3FF;color:#5925DC}.s-PARTIALLY_REFUNDED{background:#F9F5FF;color:#6941C6}
.s-PENDING{background:#EFF8FF;color:#175CD3}.s-DELIVERED{background:#ECFDF3;color:#067647}.s-FAILED{background:#FEF3F2;color:#B42318}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input,select{height:34px;border:1px solid #D0D5DD;border-radius:8px;padding:0 10px;font:inherit;background:#fff}
button,.btn{height:34px;border:0;border-radius:8px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer;background:#0E7C66;color:#fff;display:inline-flex;align-items:center}
button.sec,.btn.sec{background:#fff;color:#344054;border:1px solid #D0D5DD}
button.danger{background:#D92D20}
button.small{height:28px;padding:0 10px;font-size:12px}
button[disabled]{opacity:.5;cursor:not-allowed}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px 24px}
.kv dt{font-size:12px;color:#667085}.kv dd{margin:0 0 4px;word-break:break-all}
.cols{display:grid;grid-template-columns:2fr 1fr;gap:16px}
@media (max-width:900px){.cols{grid-template-columns:1fr}}
.flash{padding:10px 14px;border-radius:10px;margin-bottom:14px;font-weight:500}
.flash.ok{background:#ECFDF3;color:#067647}.flash.err{background:#FEF3F2;color:#B42318}
.timeline{list-style:none;margin:0;padding:0}
.timeline li{position:relative;padding:0 0 12px 18px;border-left:2px solid #E4E7EC;margin-left:5px}
.timeline li:before{content:"";position:absolute;left:-6px;top:4px;width:10px;height:10px;border-radius:50%;background:#0E7C66}
.timeline li:last-child{border-left-color:transparent}
.timeline .t{font-size:11px;color:#667085}
.timeline .ty{font-size:11px;font-weight:700;color:#344054;margin-right:6px}
details>summary{cursor:pointer;color:#175CD3;font-size:12px}
pre{background:#0F172A;color:#E2E8F0;padding:10px;border-radius:8px;overflow:auto;font-size:12px;max-height:320px;white-space:pre-wrap;word-break:break-all;margin:6px 0 0}
.pager{display:flex;gap:8px;align-items:center;margin-top:12px}
.inline{display:inline}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
`;

export interface AdminCtx {
  csrf: string;
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

function layout(ctx: AdminCtx, active: 'orders' | 'tokens' | 'merchants', title: string, body: SafeHtml): SafeHtml {
  const tab = (key: typeof active, href: string, label: string) => html`<a href="${href}" class="${key === active ? 'on' : ''}">${label}</a>`;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} · Mock Bank admin</title><style>${raw(CSS)}</style></head>
<body><header><div class="hin"><a class="logo" href="/admin">${BANK_LOGO}<span>Mock Bank <small>back office</small></span></a>
<nav>${tab('orders', '/admin/orders', 'Orders')}${tab('tokens', '/admin/tokens', 'Saved cards')}${tab('merchants', '/admin/merchants', 'Merchants')}</nav></div></header>
<main>${ctx.flash ? html`<div class="flash ${ctx.flash.kind}">${ctx.flash.text}</div>` : ''}${body}</main></body></html>`;
}

const badge = (status: string) => html`<span class="b s-${status}">${status.replace('_', ' ')}</span>`;
const csrfField = (ctx: AdminCtx) => html`<input type="hidden" name="csrf" value="${ctx.csrf}">`;

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function ordersPage(
  ctx: AdminCtx,
  data: { items: OrderRow[]; total: number; page: number; pageSize: number },
  filter: OrderListFilter,
  merchants: Merchant[],
): SafeHtml {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const link = (page: number) => `/admin/orders${qs({ status: filter.status, merchant: filter.merchantId, q: filter.q, page })}`;
  const body = html`<h1>Orders <span class="muted" style="font-size:14px;font-weight:500">${data.total} total</span></h1>
<div class="panel"><form class="filters" method="get" action="/admin/orders">
  <input name="q" placeholder="Order id / merchantOrderId / card" value="${filter.q ?? ''}" style="min-width:280px">
  <select name="status"><option value="">All statuses</option>${ORDER_STATUSES.map((s) => html`<option value="${s}" ${s === filter.status ? raw('selected') : ''}>${s}</option>`)}</select>
  <select name="merchant"><option value="">All merchants</option>${merchants.map((m) => html`<option value="${m.id}" ${m.id === filter.merchantId ? raw('selected') : ''}>${m.name} (${m.id})</option>`)}</select>
  <button type="submit">Filter</button> <a class="btn sec" href="/admin/orders">Reset</a>
</form></div>
<div class="panel"><table>
<thead><tr><th>Created</th><th>Order</th><th>Merchant</th><th>Merchant order id</th><th>Description</th><th class="num">Amount</th><th>Status</th><th>Card</th></tr></thead>
<tbody>${data.items.length === 0 ? html`<tr><td colspan="8" class="muted">No orders found.</td></tr>` : ''}
${data.items.map(
  (o) => html`<tr>
  <td class="nowrap muted">${formatDateTime(o.createdAt)}</td>
  <td class="mono"><a href="/admin/orders/${o.id}">${o.id}</a>${o.kind === 'TOKEN' ? html` <span class="b s-CREATED">TOKEN</span>` : ''}</td>
  <td>${o.merchantId}</td>
  <td class="mono">${o.merchantOrderId}</td>
  <td>${o.description}</td>
  <td class="num">${formatMoney(o.amount, o.currency)}${o.refundedAmount ? html`<div class="muted" style="font-size:12px">−${formatMoney(o.refundedAmount, o.currency)}</div>` : ''}</td>
  <td>${badge(o.status)}${o.declineCode ? html`<div class="muted mono" style="font-size:11px">${o.declineCode}</div>` : ''}</td>
  <td class="mono nowrap">${o.cardMask ?? ''}</td>
</tr>`,
)}</tbody></table>
<div class="pager">${data.page > 1 ? html`<a class="btn sec" href="${link(data.page - 1)}">← Prev</a>` : ''}<span class="muted">Page ${data.page} / ${pages}</span>${data.page < pages ? html`<a class="btn sec" href="${link(data.page + 1)}">Next →</a>` : ''}</div>
</div>`;
  return layout(ctx, 'orders', 'Orders', body);
}

export interface OrderDetailData {
  order: OrderRow;
  json: OrderJson;
  merchant: Merchant | null;
  refunds: RefundRow[];
  timeline: { id: number; type: string; message: string; createdAt: Date }[];
  webhooks: WebhookRow[];
  deliveries: DeliveryRow[];
  checkoutUrl: string;
}

export function orderDetailPage(ctx: AdminCtx, d: OrderDetailData): SafeHtml {
  const o = d.order;
  const refundable = o.status === 'APPROVED' || o.status === 'PARTIALLY_REFUNDED';
  const remaining = o.amount - o.refundedAmount;
  const canResend = Boolean(eventForStatus(o.status as OrderStatus) && o.callbackUrl);
  const field = (k: string, v: unknown, mono = false) =>
    html`<div><dt>${k}</dt><dd class="${mono ? 'mono' : ''}">${v === null || v === undefined || v === '' ? html`<span class="muted">—</span>` : v}</dd></div>`;

  const body = html`<p><a href="/admin/orders">← Orders</a></p>
<h1><span class="mono">${o.id}</span> ${badge(o.status)} <span>${formatMoney(o.amount, o.currency)}</span></h1>
<div class="cols"><div>
<div class="panel"><h2>Details</h2><dl class="kv grid">
  ${field('Merchant', d.merchant ? `${d.merchant.name} (${d.merchant.id})` : o.merchantId)}
  ${field('Merchant order id', o.merchantOrderId, true)}
  ${field('Kind', o.kind)}
  ${field('Description', o.description)}
  ${field('Amount', formatMoney(o.amount, o.currency))}
  ${field('Refunded', o.refundedAmount ? formatMoney(o.refundedAmount, o.currency) : null)}
  ${field('Card', o.cardMask ? `${o.cardMask} · ${o.cardBrand}` : null, true)}
  ${field('Cardholder', o.cardHolder)}
  ${field('Card token', o.cardToken, true)}
  ${field('Decline', o.declineCode ? `${o.declineCode} — ${o.declineReason}` : null)}
  ${field('RRN', o.rrn, true)}
  ${field('Approval code', o.approvalCode, true)}
  ${field('Language', o.language)}
  ${field('Save card requested', o.saveCard ? (o.saveCardRequested || o.cardToken ? 'yes (customer opted in)' : 'offered') : 'no')}
  ${field('OTP attempts', o.otpAttempts || null)}
  ${field('Customer', o.customer ? JSON.stringify(o.customer) : null, true)}
  ${field('Created', formatDateTime(o.createdAt))}
  ${field('Updated', formatDateTime(o.updatedAt))}
  ${field('Paid', o.paidAt ? formatDateTime(o.paidAt) : null)}
  ${field('Expires', formatDateTime(o.expiresAt))}
  ${field('Return URL', o.returnUrl, true)}
  ${field('Callback URL', o.callbackUrl, true)}
  ${o.kind === 'CHECKOUT' ? field('Checkout page', html`<a href="${d.checkoutUrl}" target="_blank" rel="noopener">${d.checkoutUrl}</a>`, true) : ''}
</dl></div>

<div class="panel"><h2>Webhooks</h2>
${d.webhooks.length === 0 ? html`<p class="muted">No webhooks sent${o.callbackUrl ? '' : ' (no callbackUrl)'}.</p>` : html`<table>
<thead><tr><th>Created</th><th>Event</th><th>Status</th><th class="num">Attempts</th><th>Last HTTP</th><th>Next attempt</th></tr></thead>
<tbody>${d.webhooks.map((w) => html`<tr><td class="nowrap muted">${formatDateTime(w.createdAt)}</td><td class="mono">${w.event}</td><td>${badge(w.status)}</td><td class="num">${w.attempts}</td><td>${w.lastStatusCode ?? '—'}</td><td class="nowrap muted">${w.status === 'PENDING' && w.nextAttemptAt ? formatDateTime(w.nextAttemptAt) : '—'}</td></tr>`)}</tbody></table>`}
<h2 style="margin-top:16px">Delivery attempts</h2>
${d.deliveries.length === 0 ? html`<p class="muted">No attempts yet.</p>` : html`<table>
<thead><tr><th>Time</th><th>Event</th><th class="num">#</th><th>Response</th><th class="num">Duration</th><th>Details</th></tr></thead>
<tbody>${d.deliveries.map(
  (a) => html`<tr>
  <td class="nowrap muted">${formatDateTime(a.createdAt)}</td>
  <td class="mono">${a.event}</td>
  <td class="num">${a.attempt}</td>
  <td>${a.responseStatus !== null ? html`<span class="b ${a.responseStatus >= 200 && a.responseStatus < 300 ? 's-DELIVERED' : 's-FAILED'}">HTTP ${a.responseStatus}</span>` : html`<span class="b s-FAILED">ERROR</span>`}${a.error ? html`<div class="muted" style="font-size:12px">${a.error}</div>` : ''}</td>
  <td class="num">${a.durationMs} ms</td>
  <td><div class="mono muted" style="font-size:11px">${a.url}</div>
    <details><summary>Response body</summary><pre>${a.responseBody || '(empty)'}</pre></details>
    <details><summary>Request body</summary><pre>${prettyJson(a.requestBody)}</pre></details></td>
</tr>`,
)}</tbody></table>`}
</div>

<div class="panel"><details><summary style="font-size:14px">Order JSON (as returned by the API)</summary><pre>${JSON.stringify(d.json, null, 2)}</pre></details></div>
</div>

<div>
<div class="panel"><h2>Actions</h2>
  <form method="post" action="/admin/orders/${o.id}/resend" class="actions">${csrfField(ctx)}
    <button type="submit" class="sec" ${canResend ? '' : raw('disabled')}>↻ Resend webhook${canResend ? html` (${eventForStatus(o.status)})` : ''}</button>
  </form>
  <hr style="border:0;border-top:1px solid #F2F4F7;margin:14px 0">
  <form method="post" action="/admin/orders/${o.id}/refund">${csrfField(ctx)}
    <div style="font-weight:600;margin-bottom:6px">Refund</div>
    ${refundable
      ? html`<div class="actions" style="margin-bottom:8px">
          <input name="amount" placeholder="Amount, e.g. ${(remaining / 100).toFixed(2)}" style="width:170px" inputmode="decimal">
          <span class="muted">${o.currency} · leave empty for full remainder (${formatMoney(remaining, o.currency)})</span></div>
        <div class="actions"><input name="reason" placeholder="Reason (optional)" style="flex:1;min-width:160px"><button type="submit" class="danger" onclick="return confirm('Refund this order?')">Refund</button></div>`
      : html`<p class="muted" style="margin:0">Only APPROVED / PARTIALLY_REFUNDED orders can be refunded.</p>`}
  </form>
</div>

<div class="panel"><h2>Refunds</h2>
${d.refunds.length === 0 ? html`<p class="muted">None.</p>` : html`<table><tbody>${d.refunds.map((r) => html`<tr><td class="mono">${r.id}<div class="muted" style="font-size:11px">${formatDateTime(r.createdAt)} · ${r.source}</div></td><td>${r.reason ?? ''}</td><td class="num">${formatMoney(r.amount, o.currency)}</td></tr>`)}</tbody></table>`}
</div>

<div class="panel"><h2>Timeline</h2><ul class="timeline">
${d.timeline.map((e) => html`<li><div class="t">${formatDateTime(e.createdAt)}</div><span class="ty">${e.type}</span>${e.message}</li>`)}
</ul></div>
</div></div>`;
  return layout(ctx, 'orders', o.id, body);
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function tokensPage(ctx: AdminCtx, tokens: CardTokenRow[], filter: { merchantId?: string; q?: string }, merchants: Merchant[]): SafeHtml {
  const body = html`<h1>Saved cards <span class="muted" style="font-size:14px;font-weight:500">${tokens.length}</span></h1>
<div class="panel"><form class="filters" method="get" action="/admin/tokens">
  <input name="q" placeholder="Token / mask / customer id" value="${filter.q ?? ''}" style="min-width:260px">
  <select name="merchant"><option value="">All merchants</option>${merchants.map((m) => html`<option value="${m.id}" ${m.id === filter.merchantId ? raw('selected') : ''}>${m.name} (${m.id})</option>`)}</select>
  <button type="submit">Filter</button> <a class="btn sec" href="/admin/tokens">Reset</a>
</form></div>
<div class="panel"><p class="muted" style="margin-top:0">Turn on <b>Insufficient funds</b> to make the next <span class="mono">charge-token</span> calls with that card decline with <span class="mono">INSUFFICIENT_FUNDS</span> (test failed subscription renewals).</p>
<table><thead><tr><th>Token</th><th>Merchant</th><th>Card</th><th>Customer</th><th>Created</th><th>Last used</th><th>Insufficient funds</th><th></th></tr></thead>
<tbody>${tokens.length === 0 ? html`<tr><td colspan="8" class="muted">No saved cards.</td></tr>` : ''}
${tokens.map(
  (tk) => html`<tr>
  <td class="mono">${tk.token}</td><td>${tk.merchantId}</td><td class="mono nowrap">${tk.mask} · ${tk.brand}</td>
  <td class="mono">${tk.customerId ?? ''}</td><td class="nowrap muted">${formatDateTime(tk.createdAt)}</td><td class="nowrap muted">${tk.lastUsedAt ? formatDateTime(tk.lastUsedAt) : '—'}</td>
  <td><form method="post" action="/admin/tokens/${tk.token}/insufficient" class="inline">${csrfField(ctx)}<input type="hidden" name="value" value="${tk.forceInsufficientFunds ? '0' : '1'}">
    <button type="submit" class="small ${tk.forceInsufficientFunds ? 'danger' : 'sec'}">${tk.forceInsufficientFunds ? 'ON — turn off' : 'OFF — turn on'}</button></form></td>
  <td><form method="post" action="/admin/tokens/${tk.token}/delete" class="inline" onsubmit="return confirm('Delete this saved card?')">${csrfField(ctx)}<button type="submit" class="small sec">Delete</button></form></td>
</tr>`,
)}</tbody></table></div>`;
  return layout(ctx, 'tokens', 'Saved cards', body);
}

export function merchantsPage(ctx: AdminCtx, merchants: MerchantStats[]): SafeHtml {
  const body = html`<h1>Merchants</h1>
<div class="panel"><p class="muted" style="margin-top:0">Configured via the <span class="mono">MERCHANTS</span> env (<span class="mono">id:secret:name</span>, comma-separated). Requests and webhooks are signed with <span class="mono">hex(HMAC_SHA256(secret, timestamp + "." + rawBody))</span>.</p>
<table><thead><tr><th>Id</th><th>Name</th><th>Secret</th><th class="num">Orders</th><th class="num">Paid</th><th class="num">Saved cards</th><th>Since</th></tr></thead>
<tbody>${merchants.map(
  (m) => html`<tr><td class="mono"><a href="/admin/orders?merchant=${encodeURIComponent(m.id)}">${m.id}</a></td><td>${m.name}</td><td class="mono">${m.secret.slice(0, 4)}••••••${m.secret.slice(-2)}</td>
  <td class="num">${m.orderCount}</td><td class="num">${m.approvedCount}</td><td class="num"><a href="/admin/tokens?merchant=${encodeURIComponent(m.id)}">${m.tokenCount}</a></td><td class="muted nowrap">${formatDateTime(m.createdAt)}</td></tr>`,
)}</tbody></table></div>`;
  return layout(ctx, 'merchants', 'Merchants', body);
}
