/* Mehad checkout.
   Live mode: talks to server.mjs, which holds the MyFatoorah token and the real order.
   Demo mode: used when no server answers (static preview); everything stays in the page and nothing is charged. */
(() => {
  'use strict';

  const DEMO_ORDER = {
    order: {
      id: 'ORD-24117',
      packageName: 'الحصة المفردة',
      subject: 'تأسيس',
      teacher: 'Rayyan AL-jaadi',
      student: 'Rayyan Test3',
      mode: 'أونلاين',
      sessions: 1,
      unitLabel: 'حصة',
    },
    price: 100,
    vouchers: [{ code: 'VOUCHAR_26', percent: 99, minTotal: 10 }],
  };
  const VAT_RATE = 0.15;
  const APPLE_PAY_NETWORKS = ['mada', 'visa', 'masterCard'];

  const $ = (id) => document.getElementById(id);
  const state = {
    mode: 'demo',
    data: null, // { order, quote, promoCode, vouchers }
    method: null,
    applePayAvailable: false,
    mf: { ready: false, sessionId: null },
    demoPromo: null,
  };

  /* ---------- helpers ---------- */

  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const round2 = (n) => Math.round(n * 100) / 100;

  function money(n, sign = '') {
    return `<span class="money" dir="ltr" aria-label="${sign}${fmt.format(n)} ريال">` +
      `${sign}<svg aria-hidden="true"><use href="#i-sar"/></svg><span>${fmt.format(n)}</span></span>`;
  }

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error((data && data.error) || 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى.');
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }

  function setBusy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  }

  function showSheet(title, body) {
    $('sheet-title').textContent = title;
    $('sheet-body').textContent = body;
    const d = $('sheet');
    if (typeof d.showModal === 'function') d.showModal();
    else toast(body);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذّر تحميل مكتبة ماي فاتورة'));
      document.head.appendChild(s);
    });
  }

  // Apple Pay only exists in Safari/WebKit on Apple devices that support it.
  function detectApplePay() {
    try {
      return Boolean(window.ApplePaySession && window.ApplePaySession.canMakePayments());
    } catch {
      return false; // e.g. inside a cross-origin frame
    }
  }

  /* ---------- demo pricing (the server owns this in live mode) ---------- */

  function demoQuote() {
    const subtotal = DEMO_ORDER.price;
    const v = DEMO_ORDER.vouchers.find((x) => x.code === state.demoPromo);
    const discount = v && subtotal >= v.minTotal ? round2(subtotal * v.percent / 100) : 0;
    const total = round2(subtotal - discount);
    return { subtotal, discount, total, vat: round2(total - total / (1 + VAT_RATE)), currency: 'SAR' };
  }

  function demoData() {
    return {
      order: DEMO_ORDER.order,
      quote: demoQuote(),
      promoCode: state.demoPromo,
      vouchers: DEMO_ORDER.vouchers,
    };
  }

  /* ---------- render ---------- */

  function render() {
    const { order, quote, promoCode, vouchers } = state.data;

    $('pkg-name').textContent = order.packageName;
    $('pkg-sub').textContent = `${order.subject} · ${order.mode}`;
    $('qty-label').textContent = `${order.sessions} × ${order.unitLabel}`;
    $('pkg-price').innerHTML = money(quote.subtotal);
    $('d-teacher').textContent = order.teacher;
    $('d-student').textContent = order.student;
    $('d-subject').textContent = order.subject;
    $('d-mode').textContent = order.mode;
    $('d-sessions').textContent = String(order.sessions);

    $('q-subtotal').innerHTML = money(quote.subtotal);
    $('q-discount-row').hidden = !quote.discount;
    $('q-discount').innerHTML = money(quote.discount, '−');
    $('q-vat').innerHTML = money(quote.vat);
    $('q-total').innerHTML = money(quote.total);
    $('bar-total').innerHTML = money(quote.total);

    $('promo-toggle').hidden = Boolean(promoCode);
    $('promo-applied').hidden = !promoCode;
    $('promo-applied-code').textContent = promoCode || '';
    if (promoCode) $('promo-panel').hidden = true;

    const list = $('voucher-list');
    list.replaceChildren(...vouchers.filter((v) => v.code !== promoCode).map(voucherItem));
    $('vouchers').hidden = list.children.length === 0;

    renderMethods();
  }

  function voucherItem(v) {
    const li = document.createElement('li');
    li.className = 'voucher';
    li.innerHTML =
      `<div class="v-text"><code dir="ltr"></code><span class="tag">خصم ${v.percent}٪</span>` +
      `<small>صالح للطلبات بقيمة ${money(v.minTotal)} أو أكثر</small></div>` +
      '<button type="button">تطبيق</button>';
    li.querySelector('code').textContent = v.code;
    li.querySelector('button').addEventListener('click', () => applyPromo(v.code));
    return li;
  }

  function renderMethods() {
    // Apple Pay is always listed; it is the default only where the device can use it.
    if (!state.method) state.method = state.applePayAvailable ? 'applepay' : 'mada';
    $(`m-${state.method}`).checked = true;
  }

  /* ---------- promo ---------- */

  async function applyPromo(raw) {
    const code = String(raw || '').trim().toUpperCase();
    const err = $('promo-error');
    err.hidden = true;
    if (!code) {
      err.textContent = 'اكتب رمز الخصم أولاً.';
      err.hidden = false;
      return;
    }
    $('promo-apply').disabled = true;
    try {
      if (state.mode === 'live') {
        state.data = await api('/api/promo', { code });
      } else {
        const v = DEMO_ORDER.vouchers.find((x) => x.code === code);
        if (!v) throw new Error('رمز الخصم غير صحيح أو منتهي.');
        if (DEMO_ORDER.price < v.minTotal) throw new Error(`هذا الرمز صالح للطلبات بقيمة ${v.minTotal} ريال أو أكثر.`);
        state.demoPromo = code;
        state.data = demoData();
      }
      $('promo-code').value = '';
      render();
      onTotalChanged();
      toast(`تم تطبيق الرمز ${code}`);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      $('promo-apply').disabled = false;
    }
  }

  async function removePromo() {
    try {
      if (state.mode === 'live') {
        state.data = await api('/api/promo', null, 'DELETE');
      } else {
        state.demoPromo = null;
        state.data = demoData();
      }
      render();
      onTotalChanged();
    } catch (e) {
      toast(e.message);
    }
  }

  function onTotalChanged() {
    if (state.mf.ready && window.myfatoorah && typeof window.myfatoorah.updateAmount === 'function') {
      window.myfatoorah.updateAmount(String(state.data.quote.total));
    }
  }

  /* ---------- Apple Pay via MyFatoorah embedded session ---------- */

  async function initApplePay(scriptUrl) {
    state.mf.ready = false;
    try {
      if (!window.myfatoorah) await loadScript(scriptUrl);
      const s = await api('/api/payments/session', {});
      state.mf.sessionId = s.sessionId;
      window.myfatoorah.init({
        sessionId: s.sessionId,
        countryCode: s.countryCode,
        currencyCode: s.currencyCode,
        amount: String(s.amount),
        callback: onApplePayAuthorized,
        containerId: 'mf-applepay',
        paymentOptions: ['ApplePay'],
        supportedNetworks: APPLE_PAY_NETWORKS,
        language: 'ar',
        settings: {
          applePay: {
            containerId: 'mf-applepay',
            callback: onApplePayAuthorized,
            supportedNetworks: APPLE_PAY_NETWORKS,
            language: 'ar',
            useCustomButton: true, // our own button calls initApplePayPayment()
            sessionStarted: () => {},
            sessionCanceled: () => setBusy(false),
            requiredShippingContactFields: ['name', 'phone', 'email'],
          },
        },
      });
      state.mf.ready = true;
    } catch (e) {
      // Apple Pay could not be prepared (domain not registered, network, ...). The tap handler explains it.
      console.error('Apple Pay init failed:', e);
      state.mf.failed = true;
    }
  }

  async function onApplePayAuthorized(response) {
    if (!response || !response.isSuccess) {
      setBusy(false);
      toast('لم تكتمل عملية Apple Pay. حاول مرة أخرى أو اختر طريقة دفع أخرى.');
      return;
    }
    setBusy(true, 'جارٍ تأكيد الدفع…');
    try {
      const r = await api('/api/payments/execute', { sessionId: response.sessionId || state.mf.sessionId });
      window.location.assign(r.paymentUrl);
    } catch (e) {
      setBusy(false);
      toast(e.message);
      initApplePay(state.scriptUrl); // a session id is single-use, so prepare a fresh one
    }
  }

  /* ---------- pay ---------- */

  function onApplePayClick() {
    if (state.mode === 'demo') {
      showSheet(
        'هنا تفتح نافذة Apple Pay',
        `على موقع مهاد الفعلي تظهر الآن نافذة Apple Pay الأصلية بمبلغ ${fmt.format(state.data.quote.total)} ريال، ` +
        'ويؤكد العميل بالضغط مرتين على الزر الجانبي أو بـ Face ID. هذه معاينة فقط ولم يتم خصم أي مبلغ.'
      );
      return;
    }
    if (!state.applePayAvailable || state.mf.failed) {
      showSheet(
        'Apple Pay غير متاح على هذا الجهاز',
        'يعمل Apple Pay على الآيفون والآيباد والماك من متصفح Safari. اختر مدى أو فيزا / ماستركارد لإكمال الدفع من هذا الجهاز.'
      );
      return;
    }
    if (!state.mf.ready) {
      toast('Apple Pay يتجهّز، حاول بعد لحظات.');
      return;
    }
    // Must run synchronously inside the tap, or Safari refuses to open the sheet.
    window.myfatoorah.initApplePayPayment();
  }

  async function onPayClick() {
    const label = state.method === 'mada' ? 'مدى' : 'فيزا / ماستركارد';
    if (state.mode === 'demo') {
      showSheet(
        `الدفع بـ ${label}`,
        'على الموقع الفعلي ينتقل العميل إلى صفحة الدفع الآمنة في ماي فاتورة لإدخال بيانات البطاقة، ثم يرجع لصفحة نتيجة الدفع. هذه معاينة فقط.'
      );
      return;
    }
    setBusy(true, 'جارٍ تحويلك لصفحة الدفع الآمنة…');
    try {
      const r = await api('/api/payments/redirect', { method: state.method });
      window.location.assign(r.paymentUrl);
    } catch (e) {
      setBusy(false);
      toast(e.message);
    }
  }

  /* ---------- wiring ---------- */

  function wire() {
    $('details-toggle').addEventListener('click', (e) => {
      const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
      e.currentTarget.setAttribute('aria-expanded', String(open));
      $('details').hidden = !open;
    });

    $('promo-toggle').addEventListener('click', (e) => {
      const open = $('promo-panel').hidden;
      $('promo-panel').hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
      if (open) $('promo-code').focus();
    });
    $('promo-panel').addEventListener('submit', (e) => {
      e.preventDefault();
      applyPromo($('promo-code').value);
    });
    $('promo-remove').addEventListener('click', removePromo);

    document.querySelectorAll('input[name="method"]').forEach((r) => {
      r.addEventListener('change', () => {
        state.method = r.value;
        renderMethods();
      });
    });

    // Same "ادفع الآن" button for every method. Apple Pay is dispatched synchronously so Safari keeps the tap gesture.
    $('pay-btn').addEventListener('click', () => {
      if (state.method === 'applepay') onApplePayClick();
      else onPayClick();
    });

    $('back-link').addEventListener('click', (e) => {
      if (history.length > 1) { e.preventDefault(); history.back(); }
    });
    $('edit-link').addEventListener('click', (e) => {
      if (history.length > 1) { e.preventDefault(); history.back(); }
    });

  }

  async function boot() {
    wire();
    state.applePayAvailable = detectApplePay();

    let config = null;
    try {
      config = await api('/api/config');
    } catch {
      config = null;
    }

    if (config && config.mode === 'live') {
      state.mode = 'live';
      state.scriptUrl = config.scriptUrl;
      try {
        state.data = await api('/api/order');
      } catch (e) {
        toast(e.message);
        return;
      }
      render();
      if (state.applePayAvailable) initApplePay(config.scriptUrl);
    } else {
      state.mode = 'demo';
      state.data = demoData();
      render();
    }
  }

  boot();
})();
