
(function(){
  var f=document.getElementById('payform');if(!f)return;
  var num=f.elements.number,exp=f.elements.expiry,cvv=f.elements.cvv,holder=f.elements.holder,badge=document.getElementById('brand'),btn=document.getElementById('paybtn');
  var M=JSON.parse(document.getElementById('i18n').textContent);
  function digits(s){return s.replace(/\D+/g,'')}
  function brand(p){if(/^4/.test(p))return'VISA';if(/^3[47]/.test(p))return'AMEX';var n=+p.slice(0,4);if(/^5[1-5]/.test(p)||(n>=2221&&n<=2720))return'MASTERCARD';if(/^62/.test(p))return'UNIONPAY';if(/^(50|5[6-9]|6)/.test(p))return'MAESTRO';return''}
  function luhn(p){if(!/^\d{12,19}$/.test(p))return false;var s=0,d=false;for(var i=p.length-1;i>=0;i--){var x=+p[i];if(d){x*=2;if(x>9)x-=9}s+=x;d=!d}return s%10===0}
  function fmt(p,b){if(b==='AMEX')return[p.slice(0,4),p.slice(4,10),p.slice(10,15)].filter(Boolean).join(' ');return p.replace(/(\d{4})(?=\d)/g,'$1 ')}
  function setErr(el,key){var w=el.closest('.field');if(!w)return;w.classList.toggle('err',!!key);var e=w.querySelector('.ferr');if(e&&key)e.textContent=M[key]}
  function onNum(){var p=digits(num.value).slice(0,19),b=brand(p);num.value=fmt(p,b);badge.textContent=b==='MASTERCARD'?'MC':(b||'');badge.className='badge '+b;badge.style.display=b?'':'none';cvv.maxLength=b==='AMEX'?4:3}
  function onExp(e){var v=digits(exp.value).slice(0,4);if(v.length===1&&+v>1)v='0'+v;if(e&&e.inputType==='deleteContentBackward'&&exp.value.length===2){exp.value=v.slice(0,1);return}exp.value=v.length>=2?v.slice(0,2)+'/'+v.slice(2):v}
  function vNum(){var p=digits(num.value);return luhn(p)?null:'numberInvalid'}
  function vExp(){var m=exp.value.match(/^(\d{2})\/(\d{2})$/);if(!m)return'expiryInvalid';var mm=+m[1],yy=2000+ +m[2];if(mm<1||mm>12)return'expiryInvalid';var n=new Date();if(yy*12+mm-1<n.getFullYear()*12+n.getMonth())return'expiryPast';return null}
  function vCvv(){var b=brand(digits(num.value));return(b==='AMEX'?/^\d{3,4}$/:/^\d{3}$/).test(cvv.value)?null:'cvvInvalid'}
  function vHolder(){var h=holder.value.trim();return h.length>=2&&h.length<=60&&/^[\p{L} .'-]+$/u.test(h)?null:'holderInvalid'}
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
})();