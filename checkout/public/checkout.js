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
  // Display currencies. The charge itself is always in SAR; SAR is pegged at 3.75 per USD.
  const FLAG_SA_SRC = 'flag-sa.png';
  const CURRENCIES = {
    SAR: { perSar: 1, flag: { img: FLAG_SA_SRC } },
    USD: { perSar: 1 / 3.75, flag: { symbol: 'i-flag-us' } },
  };
  const CURRENCY_KEY = 'mehad.checkout.currency';
  const CARD_NETWORKS = ['mada', 'visa', 'masterCard'];
  const BRAND_LOGOS = {
    mada: '<span class="logo logo-mada" aria-label="مدى"><span class="bars"><i></i><i></i></span><b>mada</b></span>',
    card: '<span class="logo logo-cards" aria-label="فيزا وماستركارد"><b>VISA</b><i class="mc"><i></i><i></i></i></span>',
  };
  // MyFatoorah draws its card fields in an iframe, so they get literal values instead of our CSS tokens.
  const MF_CARD_STYLE = {
    hideNetworkIcons: false,
    cardHeight: '250px',
    input: {
      color: '#0f2522',
      fontSize: '16px',
      fontFamily: 'Cairo, Tahoma, sans-serif',
      inputHeight: '50px',
      borderColor: '#e0e8e6',
      backgroundColor: '#f5f8f7',
      borderRadius: '14px',
      placeHolder: {
        holderName: 'الاسم كما يظهر على البطاقة',
        cardNumber: '0000 0000 0000 0000',
        expiryDate: 'MM / YY',
        securityCode: 'CVV',
      },
    },
    label: {
      display: true,
      color: '#0f2522',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: 'Cairo, Tahoma, sans-serif',
      text: {
        holderName: 'اسم حامل البطاقة',
        cardNumber: 'رقم البطاقة',
        expiryDate: 'تاريخ الانتهاء',
        securityCode: 'رمز الأمان',
      },
    },
    error: { borderColor: '#b42318', borderRadius: '14px' },
    button: { useCustomButton: true }, // our "ادفع" button calls submitCardPayment()
    separator: { useCustomSeparator: true },
  };

  const $ = (id) => document.getElementById(id);
  const state = {
    mode: 'demo',
    data: null, // { order, quote, promoCode, vouchers }
    method: null,
    applePayAvailable: false,
    mf: { ready: false, failed: false, sessionId: null },
    demoPromo: null,
    currency: 'SAR',
    view: 'checkout',
    pushedCardView: false,
  };

  /* ---------- helpers ---------- */

  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const round2 = (n) => Math.round(n * 100) / 100;
  const digits = (s) => String(s).replace(/\D/g, '');
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  // n is always in SAR; it is shown in the selected display currency unless cur says otherwise.
  function money(n, sign = '', cur = state.currency) {
    if (cur === 'USD') {
      const v = usd.format(round2(n * CURRENCIES.USD.perSar));
      return `<span class="money" dir="ltr" aria-label="${sign}${v}">${sign}${v}</span>`;
    }
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

  function showSheet(title, body, onClose) {
    $('sheet-title').textContent = title;
    $('sheet-body').textContent = body;
    const d = $('sheet');
    if (onClose) d.addEventListener('close', onClose, { once: true });
    if (typeof d.showModal === 'function') d.showModal();
    else { toast(body); if (onClose) onClose(); }
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
      // Thrown on non-HTTPS pages and in cross-origin frames; the object still means an Apple device.
      return Boolean(window.ApplePaySession);
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
    const foreign = state.currency !== 'SAR';
    $('charge-note').hidden = !foreign;
    $('charge-sar').innerHTML = money(quote.total, '', 'SAR');
    $('bar-sub').textContent = foreign ? 'شامل الضريبة · الدفع بالريال' : 'شامل الضريبة';
    renderCurrency();

    $('promo-toggle').hidden = Boolean(promoCode);
    $('promo-applied').hidden = !promoCode;
    $('promo-applied-code').textContent = promoCode || '';

    const list = $('voucher-list');
    list.replaceChildren(...vouchers.filter((v) => v.code !== promoCode).map(voucherItem));
    $('vouchers').hidden = list.children.length === 0;

    renderMethods();
    if (state.view === 'card') renderCardView();
  }

  function flagHtml(code) {
    const f = CURRENCIES[code].flag;
    return f.img
      ? `<img class="flag" src="${f.img}" alt="" width="20" height="20">`
      : `<svg class="flag" aria-hidden="true"><use href="#${f.symbol}"/></svg>`;
  }

  function renderCurrency() {
    const cur = state.currency;
    $('currency-code').textContent = cur;
    $('currency-flag').innerHTML = flagHtml(cur);
    const menu = $('currency-menu');
    menu.replaceChildren(...Object.keys(CURRENCIES).map((code) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(code === cur));
      li.tabIndex = 0;
      li.dataset.code = code;
      li.innerHTML = flagHtml(code) +
        `<span>${code}</span><svg class="check" aria-hidden="true"><use href="#i-check"/></svg>`;
      return li;
    }));
  }

  function toggleCurrencyMenu(open) {
    $('currency-menu').hidden = !open;
    $('currency-btn').setAttribute('aria-expanded', String(open));
    if (open) {
      const sel = $('currency-menu').querySelector('[aria-selected="true"]');
      if (sel) sel.focus();
    }
  }

  function setCurrency(code) {
    if (!CURRENCIES[code]) return;
    state.currency = code;
    try { localStorage.setItem(CURRENCY_KEY, code); } catch { /* storage unavailable */ }
    toggleCurrencyMenu(false);
    $('currency-btn').focus();
    render();
  }

  function voucherItem(v) {
    const eligible = state.data.quote.subtotal >= v.minTotal;
    const li = document.createElement('li');
    li.className = 'ticket';
    if (!eligible) li.setAttribute('aria-disabled', 'true');
    li.innerHTML =
      `<div class="ticket-value"><b>${v.percent}٪</b><small>خصم</small></div>` +
      `<div class="ticket-body"><code dir="ltr"></code><small>للطلبات بقيمة ${money(v.minTotal)} أو أكثر</small></div>` +
      `<button type="button" class="ticket-use"${eligible ? '' : ' disabled'}>استخدم</button>`;
    li.querySelector('code').textContent = v.code;
    li.querySelector('button').addEventListener('click', () => applyPromo(v.code));
    return li;
  }

  function renderMethods() {
    // Apple Pay is always listed; it is the default only where the device can use it.
    if (!state.method) state.method = state.applePayAvailable ? 'applepay' : 'mada';
    $(`m-${state.method}`).checked = true;
  }

  /* ---------- promo popup ---------- */

  function openPromo() {
    $('promo-error').hidden = true;
    $('promo-code').value = '';
    $('promo-code').removeAttribute('aria-invalid');
    const d = $('promo-dialog');
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    // On phones let the customer see the vouchers before the keyboard covers them.
    if (!isTouch()) $('promo-code').focus();
  }

  function closePromo() {
    const d = $('promo-dialog');
    if (d.open) d.close();
  }

  function showPromoError(msg) {
    $('promo-error').textContent = msg;
    $('promo-error').hidden = false;
    $('promo-code').setAttribute('aria-invalid', 'true');
  }

  async function applyPromo(raw) {
    const code = String(raw || '').trim().toUpperCase();
    $('promo-error').hidden = true;
    $('promo-code').removeAttribute('aria-invalid');
    if (!code) {
      showPromoError('اكتب رمز الخصم أولاً.');
      $('promo-code').focus();
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
      closePromo();
      render();
      onTotalChanged();
      toast(`تم تطبيق الرمز ${code}`);
    } catch (e) {
      showPromoError(e.message);
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

  /* ---------- views: checkout → card payment ---------- */

  function showView(name, { push = true } = {}) {
    const card = name === 'card';
    state.view = name;
    $('toast').hidden = true;
    $('view-checkout').hidden = card;
    // The card view is moved off stage rather than display:none, so MyFatoorah's iframe keeps its size.
    $('view-card').classList.toggle('is-offstage', !card);
    $('view-card').toggleAttribute('inert', !card);
    $('view-card').setAttribute('aria-hidden', String(!card));
    if (card) renderCardView();
    window.scrollTo(0, 0);
    if (card && push) {
      try {
        history.pushState({ view: 'card' }, '');
        state.pushedCardView = true;
      } catch {
        state.pushedCardView = false;
      }
    }
    if (card && state.mode === 'demo' && !isTouch()) $('cc-name').focus();
  }

  function leaveCardView() {
    if (state.pushedCardView) history.back(); // popstate brings the checkout back
    else showView('checkout', { push: false });
  }

  function renderCardView() {
    const { quote } = state.data;
    const foreign = state.currency !== 'SAR';
    $('pc-total').innerHTML = money(quote.total, '', 'SAR');
    $('pc-total-alt').hidden = !foreign;
    $('pc-total-alt').innerHTML = foreign ? `≈ ${money(quote.total)}` : '';
    $('card-pay-amount').innerHTML = money(quote.total, '', 'SAR');
    $('paycard-brands').innerHTML = BRAND_LOGOS[state.method === 'mada' ? 'mada' : 'card'];
    $('mf-fallback').hidden = !(state.mode === 'live' && state.mf.failed);
    if (state.mode === 'live') $('mf-card').hidden = state.mf.failed;
    $('paycard-note-text').textContent = state.mode === 'live'
      ? 'تُرسل بيانات البطاقة مشفّرة إلى ماي فاتورة مباشرة، ولا تحفظها مهاد.'
      : 'معاينة: بيانات البطاقة لا تُرسل ولا تُحفظ.';
  }

  /* ---------- card form (preview mode) ---------- */

  function luhn(num) {
    let sum = 0;
    let alt = false;
    for (let i = num.length - 1; i >= 0; i -= 1) {
      let d = Number(num[i]);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function cardBrand(num) {
    if (/^4/.test(num)) return 'visa';
    const p4 = Number(num.slice(0, 4));
    if (/^5[1-5]/.test(num) || (num.length >= 4 && p4 >= 2221 && p4 <= 2720)) return 'mc';
    return '';
  }

  const formatNumber = (v) => digits(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

  function formatExpiry(v) {
    let d = digits(v).slice(0, 4);
    if (d.length === 1 && d > '1') d = `0${d}`;
    return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
  }

  function setFieldError(id, msg) {
    $(id).setAttribute('aria-invalid', String(Boolean(msg)));
    $(`${id}-err`).textContent = msg || '';
  }

  function validateCard() {
    const errors = {};
    const name = $('cc-name').value.trim();
    const num = digits($('cc-number').value);
    const exp = digits($('cc-exp').value);
    const cvv = digits($('cc-cvv').value);

    if (name.length < 2) errors['cc-name'] = 'اكتب الاسم كما يظهر على البطاقة.';
    if (!num) errors['cc-number'] = 'اكتب رقم البطاقة.';
    else if (num.length < 13 || !luhn(num)) errors['cc-number'] = 'رقم البطاقة غير صحيح.';
    const mm = Number(exp.slice(0, 2));
    const yy = Number(exp.slice(2));
    if (exp.length !== 4 || mm < 1 || mm > 12) errors['cc-exp'] = 'تاريخ غير صحيح.';
    else if (new Date(2000 + yy, mm, 1) <= new Date()) errors['cc-exp'] = 'البطاقة منتهية الصلاحية.';
    if (cvv.length < 3) errors['cc-cvv'] = 'رمز غير صحيح.';

    ['cc-name', 'cc-number', 'cc-exp', 'cc-cvv'].forEach((id) => setFieldError(id, errors[id]));
    const first = Object.keys(errors)[0];
    if (first) $(first).focus();
    return !first;
  }

  function resetCardForm() {
    $('card-form').reset();
    ['cc-name', 'cc-number', 'cc-exp', 'cc-cvv'].forEach((id) => setFieldError(id, ''));
    $('cc-brand').className = 'cc-brand';
  }

  function fillDemoCard() {
    $('cc-name').value = 'RAYYAN TEST';
    $('cc-number').value = formatNumber('4111111111111111');
    $('cc-exp').value = '12 / 30';
    $('cc-cvv').value = '123';
    $('cc-brand').className = 'cc-brand is-visa';
    ['cc-name', 'cc-number', 'cc-exp', 'cc-cvv'].forEach((id) => setFieldError(id, ''));
  }

  function onCardPayClick() {
    if (state.mode === 'live') {
      // MyFatoorah validates its own fields, then calls onMyFatoorahPayment.
      if (state.mf.ready) window.myfatoorah.submitCardPayment();
      else redirectToHostedPage();
      return;
    }
    if (!validateCard()) return;
    setBusy(true, 'جارٍ معالجة الدفع…');
    setTimeout(() => {
      setBusy(false);
      showSheet(
        'تم الدفع بنجاح',
        'على الموقع الفعلي يتحقق البنك من العملية برمز التحقق (OTP) ثم يُنقل العميل لصفحة تأكيد الحجز. هذه معاينة: لم تُرسل بيانات البطاقة ولم يُخصم أي مبلغ.',
        () => { resetCardForm(); leaveCardView(); }
      );
    }, 1400);
  }

  /* ---------- MyFatoorah embedded session (card + Apple Pay) ---------- */

  async function initMyFatoorah() {
    state.mf.ready = false;
    state.mf.failed = false;
    try {
      if (!window.myfatoorah) await loadScript(state.scriptUrl);
      const s = await api('/api/payments/session', {});
      state.mf.sessionId = s.sessionId;
      const options = ['Card'];
      if (state.applePayAvailable) options.push('ApplePay');
      window.myfatoorah.init({
        sessionId: s.sessionId,
        countryCode: s.countryCode,
        currencyCode: s.currencyCode,
        amount: String(s.amount),
        callback: onMyFatoorahPayment,
        containerId: 'mf-card',
        paymentOptions: options,
        supportedNetworks: CARD_NETWORKS,
        language: 'ar',
        settings: {
          card: { style: MF_CARD_STYLE },
          applePay: {
            containerId: 'mf-applepay',
            callback: onMyFatoorahPayment,
            supportedNetworks: CARD_NETWORKS,
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
      // Domain not registered, network, ... Cards fall back to MyFatoorah's hosted page; Apple Pay explains itself.
      console.error('MyFatoorah init failed:', e);
      state.mf.failed = true;
    }
    if (state.view === 'card') renderCardView();
  }

  async function onMyFatoorahPayment(response) {
    if (!response || !response.isSuccess) {
      setBusy(false);
      toast(response && response.paymentType === 'Card'
        ? 'تحقّق من بيانات البطاقة وحاول مرة أخرى.'
        : 'لم تكتمل عملية الدفع. حاول مرة أخرى أو اختر طريقة دفع أخرى.');
      return;
    }
    setBusy(true, 'جارٍ تأكيد الدفع…');
    try {
      const r = await api('/api/payments/execute', { sessionId: response.sessionId || state.mf.sessionId });
      window.location.assign(r.paymentUrl); // 3-D Secure for cards, straight to the result for Apple Pay
    } catch (e) {
      setBusy(false);
      toast(e.message);
      initMyFatoorah(); // a session id is single-use, so prepare a fresh one
    }
  }

  async function redirectToHostedPage() {
    setBusy(true, 'جارٍ تحويلك لصفحة الدفع الآمنة…');
    try {
      const r = await api('/api/payments/redirect', { method: state.method });
      window.location.assign(r.paymentUrl);
    } catch (e) {
      setBusy(false);
      toast(e.message);
    }
  }

  /* ---------- Apple Pay sheet preview (demo mode only) ---------- */

  function setApStage(stage) {
    $('ap').dataset.stage = stage;
    $('ap-confirm').dataset.stage = stage;
    $('ap-confirm-text').textContent = { ready: 'Confirm with Side Button', processing: 'Processing', done: 'Done' }[stage];
  }

  function openApplePayPreview() {
    const { order, quote } = state.data;
    $('ap-name').textContent = order.student;
    $('ap-amount').textContent = `SAR ${quote.total.toFixed(2)}`;
    setApStage('ready');
    $('ap').hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const hint = $('ap-hint');
      const top = $('ap-sheet').offsetTop - hint.offsetHeight - 22; // offsetTop ignores the slide-in transform
      hint.hidden = top < 8;
      hint.style.top = `${Math.max(top, 0)}px`;
      $('ap').classList.add('open');
    }));
    $('ap-confirm').focus({ preventScroll: true });
  }

  function closeApplePayPreview() {
    $('ap').classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { $('ap').hidden = true; }, 350);
  }

  function confirmApplePayPreview() {
    if ($('ap').dataset.stage !== 'ready') return;
    setApStage('processing');
    setTimeout(() => {
      setApStage('done');
      setTimeout(() => {
        closeApplePayPreview();
        showSheet('تم الدفع بنجاح', 'على الموقع الفعلي يُنقل العميل بعدها لصفحة تأكيد الحجز. هذه معاينة ولم يتم خصم أي مبلغ.');
      }, 900);
    }, 1300);
  }

  /* ---------- pay ---------- */

  function onApplePayClick() {
    if (state.mode === 'demo') {
      openApplePayPreview();
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

  /* ---------- wiring ---------- */

  function wire() {
    $('currency-btn').addEventListener('click', () => toggleCurrencyMenu($('currency-menu').hidden));
    $('currency-menu').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-code]');
      if (li) setCurrency(li.dataset.code);
    });
    $('currency-menu').addEventListener('keydown', (e) => {
      const li = e.target.closest('li[data-code]');
      if (!li) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCurrency(li.dataset.code); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
        if (next) next.focus();
      }
      if (e.key === 'Escape') { toggleCurrencyMenu(false); $('currency-btn').focus(); }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.currency')) toggleCurrencyMenu(false);
    });

    document.querySelectorAll('[data-ap-close]').forEach((el) => el.addEventListener('click', () => {
      if ($('ap').dataset.stage === 'ready') closeApplePayPreview();
    }));
    $('ap-confirm').addEventListener('click', confirmApplePayPreview);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('ap').hidden && $('ap').dataset.stage === 'ready') closeApplePayPreview();
    });

    $('details-toggle').addEventListener('click', (e) => {
      const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
      e.currentTarget.setAttribute('aria-expanded', String(open));
      $('details').hidden = !open;
    });

    // Promo popup
    $('promo-toggle').addEventListener('click', openPromo);
    $('promo-x').addEventListener('click', closePromo);
    $('promo-cancel').addEventListener('click', closePromo);
    $('promo-dialog').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closePromo(); // tap on the backdrop
    });
    $('promo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      applyPromo($('promo-code').value);
    });
    $('promo-code').addEventListener('input', () => {
      $('promo-error').hidden = true;
      $('promo-code').removeAttribute('aria-invalid');
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
      else showView('card');
    });

    // Card form
    $('cc-number').addEventListener('input', (e) => {
      e.target.value = formatNumber(e.target.value);
      const brand = cardBrand(digits(e.target.value));
      $('cc-brand').className = `cc-brand${brand ? ` is-${brand}` : ''}`;
      setFieldError('cc-number', '');
    });
    $('cc-exp').addEventListener('input', (e) => {
      const deleting = e.inputType && e.inputType.startsWith('delete');
      e.target.value = deleting ? e.target.value : formatExpiry(e.target.value);
      setFieldError('cc-exp', '');
    });
    $('cc-cvv').addEventListener('input', (e) => {
      e.target.value = digits(e.target.value).slice(0, 4);
      setFieldError('cc-cvv', '');
    });
    $('cc-name').addEventListener('input', () => setFieldError('cc-name', ''));
    $('card-form').addEventListener('submit', (e) => { e.preventDefault(); onCardPayClick(); });
    $('card-pay-btn').addEventListener('click', onCardPayClick);
    $('demo-fill').addEventListener('click', fillDemoCard);
    $('change-method').addEventListener('click', leaveCardView);

    window.addEventListener('popstate', (e) => {
      const view = e.state && e.state.view === 'card' ? 'card' : 'checkout';
      state.pushedCardView = view === 'card';
      if (view !== state.view) showView(view, { push: false });
    });

    $('back-link').addEventListener('click', (e) => {
      if (state.view === 'card') { e.preventDefault(); leaveCardView(); return; }
      if (history.length > 1) { e.preventDefault(); history.back(); }
    });
    $('edit-link').addEventListener('click', (e) => {
      if (history.length > 1) { e.preventDefault(); history.back(); }
    });
  }

  async function boot() {
    try {
      const saved = localStorage.getItem(CURRENCY_KEY);
      if (CURRENCIES[saved]) state.currency = saved;
    } catch { /* storage unavailable */ }
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
      $('card-form').remove(); // live card data only ever goes into MyFatoorah's fields
      try {
        state.data = await api('/api/order');
      } catch (e) {
        toast(e.message);
        return;
      }
      render();
      initMyFatoorah();
    } else {
      state.mode = 'demo';
      state.data = demoData();
      $('mf-card').hidden = true;
      $('demo-fill').hidden = false;
      render();
    }
  }

  boot();
})();
