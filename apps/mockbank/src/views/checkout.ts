import { TEST_CARDS, type CardErrorKey, type CardField } from '../lib/cards';
import { declineMessage } from '../lib/i18n';
import type { OrderRow } from '../lib/types';
import { formatMoney } from '../lib/util';
import { checkoutLayout, LOCK_ICON, withLang, type PageContext } from './checkoutLayout';
import { formatDateTime, html, jsonScript, raw, type SafeHtml } from './html';

export interface CardFormState {
  values: { number: string; expiry: string; holder: string; saveCard: boolean };
  errors: Partial<Record<CardField, CardErrorKey>>;
  alert?: string;
}

function summary(ctx: PageContext, order: OrderRow, merchantName: string, extra?: SafeHtml): SafeHtml {
  return html`<section class="card">
  <div class="summary">
    <div class="avatar" aria-hidden="true">${merchantName.slice(0, 1).toUpperCase()}</div>
    <div class="who"><div class="name">${merchantName}</div><div class="desc">${order.description || ctx.t('order')}</div></div>
    <div class="amount">${formatMoney(order.amount, order.currency)}</div>
  </div>
  <div class="meta"><span>${ctx.t('order')}: ${order.merchantOrderId.length > 18 ? order.merchantOrderId.slice(0, 8) + '…' + order.merchantOrderId.slice(-6) : order.merchantOrderId}</span>${extra}</div>
</section>`;
}

function futureExpiry(): string {
  const d = new Date();
  return `12/${String((d.getFullYear() + 3) % 100).padStart(2, '0')}`;
}

function testCardsTable(ctx: PageContext): SafeHtml {
  const { t } = ctx;
  const label = (c: (typeof TEST_CARDS)[number]) =>
    c.outcome.kind === 'APPROVE'
      ? html`<span class="tag ok">${t('outcomeFrictionless')}</span>`
      : c.outcome.kind === '3DS'
        ? html`<span class="tag ds">${t('outcome3ds')}</span>`
        : html`<span class="tag no">${t('outcomeDeclined')} · ${c.outcome.code}</span>`;
  return html`<section class="card"><details class="tc" open>
  <summary>🧪 ${t('testCards')}</summary>
  <p>${t('testCardsHint')}</p>
  <table>
    ${TEST_CARDS.map((c) => html`<tr data-pan="${c.pan}"><td class="pan">${c.pan.replace(/(\d{4})(?=\d)/g, '$1 ')}</td><td>${label(c)}</td></tr>`)}
    <tr><td colspan="2" style="color:#6B7280;font-size:12px">${t('outcomeOther')} → <span class="tag ds">${t('outcome3ds')}</span></td></tr>
  </table>
</details></section>`;
}

const CARD_FORM_JS = `
(function(){
  var f=document.getElementById('payform');if(!f)return;
  var num=f.elements.number,exp=f.elements.expiry,cvv=f.elements.cvv,holder=f.elements.holder,badge=document.getElementById('brand'),btn=document.getElementById('paybtn');
  var M=JSON.parse(document.getElementById('i18n').textContent);
  function digits(s){return s.replace(/\\D+/g,'')}
  function brand(p){if(/^4/.test(p))return'VISA';if(/^3[47]/.test(p))return'AMEX';var n=+p.slice(0,4);if(/^5[1-5]/.test(p)||(n>=2221&&n<=2720))return'MASTERCARD';if(/^62/.test(p))return'UNIONPAY';if(/^(50|5[6-9]|6)/.test(p))return'MAESTRO';return''}
  function luhn(p){if(!/^\\d{12,19}$/.test(p))return false;var s=0,d=false;for(var i=p.length-1;i>=0;i--){var x=+p[i];if(d){x*=2;if(x>9)x-=9}s+=x;d=!d}return s%10===0}
  function fmt(p,b){if(b==='AMEX')return[p.slice(0,4),p.slice(4,10),p.slice(10,15)].filter(Boolean).join(' ');return p.replace(/(\\d{4})(?=\\d)/g,'$1 ')}
  function setErr(el,key){var w=el.closest('.field');if(!w)return;w.classList.toggle('err',!!key);var e=w.querySelector('.ferr');if(e&&key)e.textContent=M[key]}
  function onNum(){var p=digits(num.value).slice(0,19),b=brand(p);num.value=fmt(p,b);badge.textContent=b==='MASTERCARD'?'MC':(b||'');badge.className='badge '+b;badge.style.display=b?'':'none';cvv.maxLength=b==='AMEX'?4:3}
  function onExp(e){var v=digits(exp.value).slice(0,4);if(v.length===1&&+v>1)v='0'+v;if(e&&e.inputType==='deleteContentBackward'&&exp.value.length===2){exp.value=v.slice(0,1);return}exp.value=v.length>=2?v.slice(0,2)+'/'+v.slice(2):v}
  function vNum(){var p=digits(num.value);return luhn(p)?null:'numberInvalid'}
  function vExp(){var m=exp.value.match(/^(\\d{2})\\/(\\d{2})$/);if(!m)return'expiryInvalid';var mm=+m[1],yy=2000+ +m[2];if(mm<1||mm>12)return'expiryInvalid';var n=new Date();if(yy*12+mm-1<n.getFullYear()*12+n.getMonth())return'expiryPast';return null}
  function vCvv(){var b=brand(digits(num.value));return(b==='AMEX'?/^\\d{3,4}$/:/^\\d{3}$/).test(cvv.value)?null:'cvvInvalid'}
  function vHolder(){var h=holder.value.trim();return h.length>=2&&h.length<=60&&/^[\\p{L} .'-]+$/u.test(h)?null:'holderInvalid'}
  num.addEventListener('input',function(){onNum();setErr(num,null);var p=digits(num.value);if(p.length>=16&&luhn(p))exp.focus()});
  num.addEventListener('blur',function(){if(num.value)setErr(num,vNum())});
  exp.addEventListener('input',function(e){onExp(e);setErr(exp,null);if(exp.value.length===5)cvv.focus()});
  exp.addEventListener('blur',function(){if(exp.value)setErr(exp,vExp())});
  cvv.addEventListener('input',function(){cvv.value=digits(cvv.value);setErr(cvv,null)});
  holder.addEventListener('input',function(){var s=holder.selectionStart;holder.value=holder.value.toUpperCase();try{holder.setSelectionRange(s,s)}catch(_){}setErr(holder,null)});
  f.addEventListener('submit',function(ev){
    var checks=[[num,vNum()],[exp,vExp()],[cvv,vCvv()],[holder,vHolder()]],first=null;
    checks.forEach(function(c){setErr(c[0],c[1]);if(c[1]&&!first)first=c[0]});
    if(first){ev.preventDefault();first.focus();return}
    btn.disabled=true;btn.textContent=M.processing;
  });
  document.querySelectorAll('tr[data-pan]').forEach(function(r){r.addEventListener('click',function(){
    num.value=r.getAttribute('data-pan');onNum();exp.value=M.testExpiry;cvv.value='123';if(!holder.value)holder.value='TEST CARDHOLDER';
    [num,exp,cvv,holder].forEach(function(x){setErr(x,null)});window.scrollTo({top:0,behavior:'smooth'});btn.focus();
  })});
  var t=document.getElementById('timer');if(t){var end=+t.getAttribute('data-end');(function tick(){var s=Math.max(0,Math.round((end-Date.now())/1000));t.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(s<=0){location.reload();return}setTimeout(tick,1000)})()}
  onNum();
})();`;

export function renderCardForm(
  ctx: PageContext,
  order: OrderRow,
  merchantName: string,
  state: CardFormState,
): SafeHtml {
  const { t } = ctx;
  const err = (f: CardField) => (state.errors[f] ? 'field err' : 'field');
  const errText = (f: CardField) => (state.errors[f] ? t(state.errors[f]!) : '');
  const nonce = order.formNonce;
  const amount = formatMoney(order.amount, order.currency);
  const timer = html`<span>${LOCK_ICON} <span class="timer" id="timer" data-end="${new Date(order.expiresAt).getTime()}"></span></span>`;
  const i18n = {
    numberInvalid: t('numberInvalid'),
    expiryInvalid: t('expiryInvalid'),
    expiryPast: t('expiryPast'),
    cvvInvalid: t('cvvInvalid'),
    holderInvalid: t('holderInvalid'),
    processing: t('processing'),
    testExpiry: futureExpiry(),
  };

  const body = html`<main>
${summary(ctx, order, merchantName, timer)}
<section class="card">
  ${state.alert ? html`<div class="alert alert-err" role="alert">${state.alert}</div>` : ''}
  <form id="payform" method="post" action="${withLang(`/checkout/${order.id}/pay`, ctx)}" novalidate autocomplete="on">
    <input type="hidden" name="nonce" value="${nonce}">
    <div class="${err('number')}">
      <label for="number">${t('cardNumber')}</label>
      <div class="with-badge">
        <input class="input mono" id="number" name="number" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" maxlength="23" value="${state.values.number}" required autofocus>
        <span class="badge" id="brand" style="display:none"></span>
      </div>
      <div class="ferr">${errText('number')}</div>
    </div>
    <div class="row">
      <div class="${err('expiry')}">
        <label for="expiry">${t('expiry')}</label>
        <input class="input mono" id="expiry" name="expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="${t('expiryPlaceholder')}" maxlength="5" value="${state.values.expiry}" required>
        <div class="ferr">${errText('expiry')}</div>
      </div>
      <div class="${err('cvv')}">
        <label for="cvv" title="${t('cvvHint')}">${t('cvv')}</label>
        <input class="input mono" id="cvv" name="cvv" type="password" inputmode="numeric" autocomplete="cc-csc" placeholder="•••" maxlength="4" required>
        <div class="ferr">${errText('cvv')}</div>
      </div>
    </div>
    <div class="${err('holder')}">
      <label for="holder">${t('holder')}</label>
      <input class="input" id="holder" name="holder" autocomplete="cc-name" autocapitalize="characters" spellcheck="false" placeholder="${t('holderPlaceholder')}" maxlength="60" value="${state.values.holder}" required>
      <div class="ferr">${errText('holder')}</div>
    </div>
    ${order.saveCard
      ? html`<label class="check"><input type="checkbox" name="saveCard" value="1" ${state.values.saveCard ? raw('checked') : ''}><span>${t('saveCard')}<span class="hint">${t('saveCardHint')}</span></span></label>`
      : ''}
    <button class="btn btn-primary" id="paybtn" type="submit">${LOCK_ICON} ${t('pay', { amount })}</button>
  </form>
  <form method="post" action="${withLang(`/checkout/${order.id}/cancel`, ctx)}">
    <input type="hidden" name="nonce" value="${nonce}">
    <button class="btn btn-ghost" type="submit">${t('cancel')}</button>
  </form>
  <div class="note">${LOCK_ICON}<span>${t('secureNote')}</span></div>
  <div class="schemes"><span>VISA</span><span>MASTERCARD</span><span>3-D SECURE</span><span>PCI DSS</span></div>
</section>
${ctx.isProd ? '' : testCardsTable(ctx)}
<div class="footer">${t('securedBy')}</div>
</main>
<script type="application/json" id="i18n">${jsonScript(i18n)}</script>
<script>${raw(CARD_FORM_JS)}</script>`;
  return checkoutLayout(ctx, { title: t('htmlTitle'), body });
}

// ------------------------------------------------------------------ 3-D Secure (ACS)

const ACS_CSS = `
.acs{max-width:440px;margin:0 auto;padding:16px 12px 32px}
.acs-box{background:#fff;border:1px solid #D9DEE5;border-radius:6px;overflow:hidden;box-shadow:0 2px 10px rgba(16,24,40,.06)}
.acs-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #E4E7EC;background:#FAFBFC}
.acs-head .bank{display:flex;align-items:center;gap:8px;font-weight:700;color:#0F2742}
.acs-head .schemes2{display:flex;gap:6px}
.acs-head .schemes2 span{font-size:10px;font-weight:800;font-style:italic;padding:3px 6px;border-radius:3px;letter-spacing:.3px}
.acs-head .vs{background:#1A1F71;color:#fff}.acs-head .mc{background:#111;color:#F79E1B}
.acs-body{padding:18px}
.acs-body h1{font-size:18px;margin:0 0 6px;color:#0F2742}
.acs-body p.lead{color:#475467;font-size:14px;margin:0 0 16px}
.acs-table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px}
.acs-table td{padding:7px 0;border-bottom:1px solid #F2F4F7}
.acs-table td:first-child{color:#667085;width:44%}
.acs-table td:last-child{font-weight:600;text-align:right}
.otp{height:54px;font-size:24px;letter-spacing:10px;text-align:center;font-variant-numeric:tabular-nums}
.acs-links{display:flex;justify-content:space-between;margin-top:12px;font-size:13px}
.linkbtn{background:none;border:0;color:#175CD3;padding:6px 0;font:inherit;font-size:13px;cursor:pointer;text-decoration:underline}
.linkbtn.muted{color:#667085}
.acs-foot{padding:10px 18px;border-top:1px solid #E4E7EC;background:#FAFBFC;font-size:11px;color:#98A2B3;text-align:center}
.btn-acs{background:#0F2742;color:#fff}.btn-acs:hover{background:#163A5F}
`;

function maskPhone(phone: string | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/[^\d+]/g, '');
  if (d.length < 6) return '';
  return ` ${d.slice(0, 4)} ** *** ${d.slice(-4, -2)} ${d.slice(-2)}`;
}

export function renderThreeDs(
  ctx: PageContext,
  order: OrderRow,
  merchantName: string,
  state: { error?: string; info?: string },
): SafeHtml {
  const { t } = ctx;
  const body = html`<main class="acs">
<div class="acs-box">
  <div class="acs-head">
    <div class="bank">${raw('<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0F2742"/><path d="M16 6 6 11v2h20v-2L16 6Zm-7 9v8H7v3h18v-3h-2v-8h-3v8h-2.5v-8h-3v8H12v-8H9Z" fill="#fff"/></svg>')}<span>Mock Bank 3-D Secure</span></div>
    <div class="schemes2"><span class="vs">VISA Secure</span><span class="mc">ID Check</span></div>
  </div>
  <div class="acs-body">
    <h1>${t('acsTitle')}</h1>
    <p class="lead">${t('acsIntro', { phone: maskPhone(order.customer?.phone) })}</p>
    <table class="acs-table">
      <tr><td>${t('acsMerchant')}</td><td>${merchantName}</td></tr>
      <tr><td>${t('acsAmount')}</td><td>${formatMoney(order.amount, order.currency)}</td></tr>
      <tr><td>${t('acsDate')}</td><td>${formatDateTime(new Date())}</td></tr>
      <tr><td>${t('acsCard')}</td><td>${order.cardMask ? order.cardMask.replace(/^(\d{4})(\d{2})\*+(\d{4})$/, '$1 $2** **** $3') : ''}</td></tr>
    </table>
    ${ctx.isProd ? '' : html`<div class="alert alert-warn"><b>${t('testOtp', { otp: '111111' })}</b></div>`}
    ${state.error ? html`<div class="alert alert-err" role="alert">${state.error}</div>` : ''}
    ${state.info ? html`<div class="alert alert-info">${state.info}</div>` : ''}
    <form method="post" action="${withLang(`/checkout/${order.id}/3ds`, ctx)}" autocomplete="off" onsubmit="var b=this.querySelector('button');b.disabled=true">
      <input type="hidden" name="nonce" value="${order.formNonce}">
      <div class="field">
        <label for="otp">${t('otp')}</label>
        <input class="input otp" id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required autofocus>
      </div>
      <button class="btn btn-acs" type="submit">${t('confirm')}</button>
    </form>
    <div class="acs-links">
      <form method="post" action="${withLang(`/checkout/${order.id}/3ds/resend`, ctx)}"><input type="hidden" name="nonce" value="${order.formNonce}"><button class="linkbtn" type="submit">${t('resend')}</button></form>
      <form method="post" action="${withLang(`/checkout/${order.id}/3ds/cancel`, ctx)}"><input type="hidden" name="nonce" value="${order.formNonce}"><button class="linkbtn muted" type="submit">${t('cancelPayment')}</button></form>
    </div>
  </div>
  <div class="acs-foot">${t('acsFooter')}</div>
</div>
</main>
<script>(function(){var o=document.getElementById('otp');o&&o.addEventListener('input',function(){o.value=o.value.replace(/\\D+/g,'').slice(0,6)})})();</script>`;
  return checkoutLayout(ctx, { title: t('acsTitle'), body, head: html`<style>${raw(ACS_CSS)}</style>`, showTopbar: false });
}

// ------------------------------------------------------------------ result

const RESULT_CSS = `
.result{text-align:center;padding-top:28px}
.ricon{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.ricon.ok{background:var(--ok-bg);color:#12B76A}.ricon.no{background:var(--danger-bg);color:var(--danger)}.ricon.neutral{background:#F2F4F7;color:#667085}
.result h1{font-size:21px;margin:0 0 4px}
.result .big{font-size:28px;font-weight:700;margin:6px 0 2px}
.result .sub{color:var(--muted);font-size:14px;margin:4px 0 0}
.kv{width:100%;border-collapse:collapse;font-size:14px;margin:18px 0 6px;text-align:left}
.kv td{padding:8px 0;border-top:1px solid var(--line)}
.kv td:first-child{color:var(--muted)}
.kv td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.progress{height:4px;background:#EAECF0;border-radius:4px;overflow:hidden;margin:18px 0 10px}
.progress i{display:block;height:100%;width:0;background:var(--primary);animation:fill 2s linear forwards}
@keyframes fill{to{width:100%}}
.redir{color:var(--muted);font-size:13px;margin-bottom:12px}
`;

const ICONS = {
  ok: raw('<svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>'),
  no: raw('<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>'),
  neutral: raw('<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 7.5V12l3 2"/></svg>'),
};

export function renderResult(ctx: PageContext, order: OrderRow, merchantName: string, opts: { returnHref: string; autoRedirect: boolean }): SafeHtml {
  const { t, lang } = ctx;
  const s = order.status;
  const kind = s === 'APPROVED' ? 'ok' : s === 'DECLINED' ? 'no' : 'neutral';
  const title =
    s === 'APPROVED' ? t('approvedTitle')
      : s === 'DECLINED' ? t('declinedTitle')
        : s === 'CANCELLED' ? t('cancelledTitle')
          : s === 'EXPIRED' ? t('expiredTitle')
            : t('refundedTitle');
  const subtitle =
    s === 'DECLINED' ? declineMessage(lang, order.declineCode)
      : s === 'CANCELLED' ? t('cancelledText')
        : s === 'EXPIRED' ? t('expiredText')
          : '';
  const rows: [string, string][] = [[t('merchant'), merchantName]];
  if (order.description) rows.push([t('description'), order.description]);
  if (order.cardMask) rows.push([t('card'), `${order.cardBrand ?? ''} •••• ${order.cardMask.slice(-4)}`.trim()]);
  if (order.approvalCode) rows.push([t('approvalCode'), order.approvalCode]);
  if (order.rrn) rows.push([t('rrn'), order.rrn]);
  rows.push([t('date'), formatDateTime(order.paidAt ?? order.updatedAt)]);

  const body = html`<main>
<section class="card result">
  <div class="ricon ${kind}">${ICONS[kind]}</div>
  <h1>${title}</h1>
  <div class="big">${formatMoney(order.amount, order.currency)}</div>
  ${subtitle ? html`<p class="sub">${subtitle}</p>` : ''}
  <table class="kv">${rows.map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td></tr>`)}</table>
  ${opts.autoRedirect ? html`<div class="progress"><i></i></div><div class="redir">${t('redirecting', { merchant: merchantName })}</div>` : ''}
  <a class="btn btn-primary" id="back" href="${opts.returnHref}">${t('returnTo', { merchant: merchantName })}</a>
</section>
<div class="footer">${t('securedBy')}</div>
</main>
${opts.autoRedirect ? html`<script>setTimeout(function(){location.replace(document.getElementById('back').href)},2000)</script>` : ''}`;
  return checkoutLayout(ctx, {
    title,
    body,
    head: html`<style>${raw(RESULT_CSS)}</style>${opts.autoRedirect ? html`<meta http-equiv="refresh" content="3;url=${opts.returnHref}">` : ''}`,
  });
}

export function renderNotFound(ctx: PageContext): SafeHtml {
  const { t } = ctx;
  const body = html`<main><section class="card result" style="text-align:center;padding-top:28px">
  <div class="ricon neutral" style="width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;background:#F2F4F7;color:#667085">${ICONS.neutral}</div>
  <h1 style="font-size:20px;margin:0 0 6px">${t('notFoundTitle')}</h1>
  <p style="color:#6B7280;margin:0">${t('notFoundText')}</p>
</section></main>`;
  return checkoutLayout(ctx, { title: t('notFoundTitle'), body });
}
