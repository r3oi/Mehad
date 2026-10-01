/* Mehad checkout.
   Live mode: talks to server.mjs, which holds the MyFatoorah token and the real order.
   Demo mode: used when no server answers (static preview); everything stays in the page and nothing is charged. */
(() => {
  'use strict';

  const I18N = {
    ar: {
      docTitle: 'دفع مهاد', nav: 'التنقل', back: 'رجوع', brand: 'مهاد',
      checkoutTitle: 'إتمام الشراء', orderSummary: 'ملخص الطلب', edit: 'تعديل',
      teacher: 'المعلم', student: 'الطالب', subject: 'المادة', mode: 'طريقة التعليم', sessions: 'عدد الحصص',
      paymentSummary: 'ملخص الدفع', addPromo: 'أضف رمز خصم', enterCode: 'أدخل الرمز', applied: 'تم تطبيق', remove: 'إزالة',
      subtotal: 'المجموع الفرعي', discount: 'الخصم', vat: 'ضريبة القيمة المضافة ١٥٪', included: '(مشمولة)', total: 'الإجمالي',
      paymentMethod: 'طريقة الدفع', mada: 'مدى', cards: 'فيزا / ماستركارد',
      gatewayNote: 'تتم معالجة بيانات الدفع عبر بوابة ماي فاتورة الآمنة، ولا تحفظ مهاد أي بيانات للبطاقات.',
      payNow: 'ادفع الآن', inclVat: 'شامل الضريبة',
      cardTitle: 'الدفع بالبطاقة', secure: 'اتصال آمن', cardDetails: 'بيانات البطاقة', amountDue: 'المبلغ المستحق',
      mfFallback: 'تعذّر تحميل نموذج البطاقة الآن. اضغط «ادفع» وسننقلك لصفحة الدفع الآمنة في ماي فاتورة.',
      ccName: 'اسم حامل البطاقة', ccNamePh: 'الاسم كما يظهر على البطاقة', ccNumber: 'رقم البطاقة',
      ccExp: 'تاريخ الانتهاء', ccCvv: 'رمز الأمان', pay: 'ادفع', fillTest: 'تعبئة بطاقة تجريبية',
      changeMethod: 'تغيير طريقة الدفع', ok: 'تمام',
      promoTitle: 'استخدم رمز الخصم', promoSub: 'اكتب الرمز أو اختر قسيمة من القسائم المتاحة لك.', close: 'إغلاق',
      promoLabel: 'رمز الخصم', promoPh: 'مثال: MEHAD10', yourVouchers: 'القسائم المتاحة لك', cancel: 'إلغاء', apply: 'تطبيق',
      switchTo: 'English',
      riyal: 'ريال', percent: (n) => `${n}٪`, off: 'خصم', use: 'استخدم',
      minOrder: (m) => `للطلبات بقيمة ${m} أو أكثر`,
      promoEmpty: 'اكتب رمز الخصم أولاً.', promoBad: 'رمز الخصم غير صحيح أو منتهي.',
      promoMin: (n) => `هذا الرمز صالح للطلبات بقيمة ${n} ريال أو أكثر.`, promoApplied: (c) => `تم تطبيق الرمز ${c}`,
      noteLive: 'تُرسل بيانات البطاقة مشفّرة إلى ماي فاتورة مباشرة، ولا تحفظها مهاد.',
      noteDemo: 'معاينة: بيانات البطاقة لا تُرسل ولا تُحفظ.',
      errName: 'اكتب الاسم كما يظهر على البطاقة.', errNumberEmpty: 'اكتب رقم البطاقة.', errNumber: 'رقم البطاقة غير صحيح.',
      errExp: 'تاريخ غير صحيح.', errExpired: 'البطاقة منتهية الصلاحية.', errCvv: 'رمز غير صحيح.',
      busyProcessing: 'جارٍ معالجة الدفع…', busyConfirming: 'جارٍ تأكيد الدفع…', busyRedirect: 'جارٍ تحويلك لصفحة الدفع الآمنة…',
      paidTitle: 'تم الدفع بنجاح',
      paidCardBody: 'على الموقع الفعلي يتحقق البنك من العملية برمز التحقق (OTP) ثم يُنقل العميل لصفحة تأكيد الحجز. هذه معاينة: لم تُرسل بيانات البطاقة ولم يُخصم أي مبلغ.',
      paidApBody: 'على الموقع الفعلي يُنقل العميل بعدها لصفحة تأكيد الحجز. هذه معاينة ولم يتم خصم أي مبلغ.',
      apUnavailableTitle: 'Apple Pay غير متاح على هذا الجهاز',
      apUnavailableBody: 'يعمل Apple Pay على الآيفون والآيباد والماك من متصفح Safari. اختر مدى أو فيزا / ماستركارد لإكمال الدفع من هذا الجهاز.',
      apPreparing: 'Apple Pay يتجهّز، حاول بعد لحظات.',
      cardFailed: 'تحقّق من بيانات البطاقة وحاول مرة أخرى.', payFailed: 'لم تكتمل عملية الدفع. حاول مرة أخرى أو اختر طريقة دفع أخرى.',
      network: 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى.', scriptFailed: 'تعذّر تحميل مكتبة ماي فاتورة',
      madaAria: 'مدى', cardsAria: 'فيزا وماستركارد',
    },
    en: {
      docTitle: 'Mehad Checkout', nav: 'Navigation', back: 'Back', brand: 'Mehad',
      checkoutTitle: 'Checkout', orderSummary: 'Order summary', edit: 'Edit',
      teacher: 'Teacher', student: 'Student', subject: 'Subject', mode: 'Learning mode', sessions: 'Sessions',
      paymentSummary: 'Payment summary', addPromo: 'Add promo code', enterCode: 'Enter code', applied: 'Applied', remove: 'Remove',
      subtotal: 'Subtotal', discount: 'Discount', vat: 'VAT 15%', included: '(included)', total: 'Total',
      paymentMethod: 'Payment method', mada: 'mada', cards: 'Visa / Mastercard',
      gatewayNote: "Payments are processed by MyFatoorah's secure gateway. Mehad never stores card details.",
      payNow: 'Pay now', inclVat: 'Including VAT',
      cardTitle: 'Card payment', secure: 'Secure connection', cardDetails: 'Card details', amountDue: 'Amount due',
      mfFallback: "The card form couldn't load right now. Tap Pay and we'll take you to MyFatoorah's secure payment page.",
      ccName: 'Cardholder name', ccNamePh: 'Name as shown on the card', ccNumber: 'Card number',
      ccExp: 'Expiry date', ccCvv: 'Security code', pay: 'Pay', fillTest: 'Fill a test card',
      changeMethod: 'Change payment method', ok: 'OK',
      promoTitle: 'Redeem a promo code', promoSub: 'Enter a code or pick one of your vouchers.', close: 'Close',
      promoLabel: 'Promo code', promoPh: 'e.g. MEHAD10', yourVouchers: 'Your vouchers', cancel: 'Cancel', apply: 'Apply',
      switchTo: 'العربية',
      riyal: 'SAR', percent: (n) => `${n}%`, off: 'off', use: 'Use',
      minOrder: (m) => `On orders of ${m} or more`,
      promoEmpty: 'Enter a promo code first.', promoBad: 'This promo code is invalid or has expired.',
      promoMin: (n) => `This code is valid on orders of ${n} SAR or more.`, promoApplied: (c) => `Promo code ${c} applied`,
      noteLive: "Card details go encrypted straight to MyFatoorah. Mehad doesn't store them.",
      noteDemo: "Preview: card details aren't sent or stored.",
      errName: 'Enter the name as shown on the card.', errNumberEmpty: 'Enter the card number.', errNumber: 'This card number is not valid.',
      errExp: 'Invalid date.', errExpired: 'This card has expired.', errCvv: 'Invalid code.',
      busyProcessing: 'Processing payment…', busyConfirming: 'Confirming payment…', busyRedirect: 'Taking you to the secure payment page…',
      paidTitle: 'Payment successful',
      paidCardBody: "On the live site the bank verifies the payment with a one-time code (OTP), then the customer lands on the booking confirmation. This is a preview: no card details were sent and nothing was charged.",
      paidApBody: 'On the live site the customer then lands on the booking confirmation. This is a preview and nothing was charged.',
      apUnavailableTitle: "Apple Pay isn't available on this device",
      apUnavailableBody: 'Apple Pay works in Safari on iPhone, iPad and Mac. Choose mada or Visa / Mastercard to pay on this device.',
      apPreparing: 'Apple Pay is getting ready. Try again in a moment.',
      cardFailed: 'Check your card details and try again.', payFailed: "The payment wasn't completed. Try again or choose another payment method.",
      network: "Couldn't reach the server. Check your connection and try again.", scriptFailed: "Couldn't load the MyFatoorah library",
      madaAria: 'mada', cardsAria: 'Visa and Mastercard',
    },
  };
  const LANG_KEY = 'mehad.checkout.lang';
  // Order text the server sends in the requested language; the preview keeps both here.
  const DEMO_TEXT = {
    ar: { packageName: 'الحصة المفردة', subject: 'تأسيس', mode: 'أونلاين', unitLabel: 'حصة' },
    en: { packageName: 'Single session', subject: 'Foundations', mode: 'Online', unitLabel: 'session' },
  };
  const DEMO_ORDER = {
    order: {
      id: 'ORD-24117',
      teacher: 'Rayyan AL-jaadi',
      student: 'Rayyan Test3',
      sessions: 1,
    },
    price: 100,
    vouchers: [{ code: 'VOUCHAR_26', percent: 99, minTotal: 10 }],
  };
  const VAT_RATE = 0.15;
  const CARD_NETWORKS = ['mada', 'visa', 'masterCard'];
  const brandLogo = (method) => (method === 'mada'
    ? `<span class="logo logo-mada" role="img" aria-label="${t('madaAria')}"><span class="bars"><i></i><i></i></span><b>mada</b></span>`
    : `<span class="logo logo-cards" role="img" aria-label="${t('cardsAria')}"><b>VISA</b><i class="mc"><i></i><i></i></i></span>`);
  // MyFatoorah draws its card fields in an iframe, so they get literal values instead of our CSS tokens.
  const mfCardStyle = () => ({
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
        holderName: t('ccNamePh'),
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
        holderName: t('ccName'),
        cardNumber: t('ccNumber'),
        expiryDate: t('ccExp'),
        securityCode: t('ccCvv'),
      },
    },
    error: { borderColor: '#b42318', borderRadius: '14px' },
    button: { useCustomButton: true }, // our "ادفع" button calls submitCardPayment()
    separator: { useCustomSeparator: true },
  });

  const $ = (id) => document.getElementById(id);
  const state = {
    mode: 'demo',
    data: null, // { order, quote, promoCode, vouchers }
    method: null,
    applePayAvailable: false,
    mf: { ready: false, failed: false, sessionId: null },
    demoPromo: null,
    view: 'checkout',
    pushedCardView: false,
    lang: 'ar',
  };

  function t(key, ...args) {
    const v = I18N[state.lang][key] ?? I18N.ar[key];
    return typeof v === 'function' ? v(...args) : v;
  }

  /* ---------- helpers ---------- */

  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const round2 = (n) => Math.round(n * 100) / 100;
  const digits = (s) => String(s).replace(/\D/g, '');
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

  function money(n, sign = '') {
    return `<span class="money" dir="ltr" aria-label="${sign}${fmt.format(n)} ${t('riyal')}">` +
      `${sign}<svg aria-hidden="true"><use href="#i-sar"/></svg><span>${fmt.format(n)}</span></span>`;
  }

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'X-Lang': state.lang, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error((data && data.error) || t('network'));
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
      s.onerror = () => reject(new Error(t('scriptFailed')));
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
      order: { ...DEMO_ORDER.order, ...DEMO_TEXT[state.lang] },
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

    const list = $('voucher-list');
    list.replaceChildren(...vouchers.filter((v) => v.code !== promoCode).map(voucherItem));
    $('vouchers').hidden = list.children.length === 0;

    renderMethods();
    if (state.view === 'card') renderCardView();
  }

  function voucherItem(v) {
    const eligible = state.data.quote.subtotal >= v.minTotal;
    const li = document.createElement('li');
    li.className = 'ticket';
    if (!eligible) li.setAttribute('aria-disabled', 'true');
    li.innerHTML =
      `<div class="ticket-value"><b>${t('percent', v.percent)}</b><small>${t('off')}</small></div>` +
      `<div class="ticket-body"><code dir="ltr"></code><small>${t('minOrder', money(v.minTotal))}</small></div>` +
      `<button type="button" class="ticket-use"${eligible ? '' : ' disabled'}>${t('use')}</button>`;
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
      showPromoError(t('promoEmpty'));
      $('promo-code').focus();
      return;
    }
    $('promo-apply').disabled = true;
    try {
      if (state.mode === 'live') {
        state.data = await api('/api/promo', { code });
      } else {
        const v = DEMO_ORDER.vouchers.find((x) => x.code === code);
        if (!v) throw new Error(t('promoBad'));
        if (DEMO_ORDER.price < v.minTotal) throw new Error(t('promoMin', v.minTotal));
        state.demoPromo = code;
        state.data = demoData();
      }
      closePromo();
      render();
      onTotalChanged();
      toast(t('promoApplied', code));
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
    $('pc-total').innerHTML = money(quote.total);
    $('card-pay-amount').innerHTML = money(quote.total);
    $('paycard-brands').innerHTML = brandLogo(state.method);
    $('mf-fallback').hidden = !(state.mode === 'live' && state.mf.failed);
    if (state.mode === 'live') $('mf-card').hidden = state.mf.failed;
    $('paycard-note-text').textContent = state.mode === 'live' ? t('noteLive') : t('noteDemo');
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

    if (name.length < 2) errors['cc-name'] = t('errName');
    if (!num) errors['cc-number'] = t('errNumberEmpty');
    else if (num.length < 13 || !luhn(num)) errors['cc-number'] = t('errNumber');
    const mm = Number(exp.slice(0, 2));
    const yy = Number(exp.slice(2));
    if (exp.length !== 4 || mm < 1 || mm > 12) errors['cc-exp'] = t('errExp');
    else if (new Date(2000 + yy, mm, 1) <= new Date()) errors['cc-exp'] = t('errExpired');
    if (cvv.length < 3) errors['cc-cvv'] = t('errCvv');

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
    setBusy(true, t('busyProcessing'));
    setTimeout(() => {
      setBusy(false);
      showSheet(t('paidTitle'), t('paidCardBody'), () => { resetCardForm(); leaveCardView(); });
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
        language: state.lang,
        settings: {
          card: { style: mfCardStyle() },
          applePay: {
            containerId: 'mf-applepay',
            callback: onMyFatoorahPayment,
            supportedNetworks: CARD_NETWORKS,
            language: state.lang,
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
      toast(response && response.paymentType === 'Card' ? t('cardFailed') : t('payFailed'));
      return;
    }
    setBusy(true, t('busyConfirming'));
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
    setBusy(true, t('busyRedirect'));
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
        showSheet(t('paidTitle'), t('paidApBody'));
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
      showSheet(t('apUnavailableTitle'), t('apUnavailableBody'));
      return;
    }
    if (!state.mf.ready) {
      toast(t('apPreparing'));
      return;
    }
    // Must run synchronously inside the tap, or Safari refuses to open the sheet.
    window.myfatoorah.initApplePayPayment();
  }

  /* ---------- language ---------- */

  function applyLang() {
    const root = document.documentElement;
    root.lang = state.lang;
    root.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('docTitle');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.querySelectorAll('[data-i18n-alt]').forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
    $('lang-btn').textContent = t('switchTo');
    $('lang-btn').lang = state.lang === 'ar' ? 'en' : 'ar';
  }

  async function switchLang() {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem(LANG_KEY, state.lang); } catch { /* storage unavailable */ }
    applyLang();
    if ($('card-form')) ['cc-name', 'cc-number', 'cc-exp', 'cc-cvv'].forEach((id) => setFieldError(id, ''));
    $('promo-error').hidden = true;
    if (state.mode === 'live') {
      try { state.data = await api('/api/order'); } catch (e) { toast(e.message); }
      render();
      initMyFatoorah(); // MyFatoorah's card labels and Apple Pay sheet follow the new language
    } else {
      state.data = demoData();
      render();
    }
  }

  /* ---------- wiring ---------- */

  function wire() {
    $('lang-btn').addEventListener('click', switchLang);

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
    // A page built as English (<html data-default-lang="en">) always opens in English;
    // otherwise the page opens in the customer's last choice, Arabic by default.
    const pageLang = document.documentElement.dataset.defaultLang;
    state.lang = pageLang === 'en' ? 'en' : 'ar';
    if (!pageLang) {
      try {
        const savedLang = localStorage.getItem(LANG_KEY);
        if (I18N[savedLang]) state.lang = savedLang;
      } catch { /* storage unavailable */ }
    }
    applyLang();
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
