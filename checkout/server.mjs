// Mehad checkout prototype server (Node 18+, no dependencies).
// Serves the page and talks to MyFatoorah so the API token never reaches the browser.
// Without MYFATOORAH_TOKEN it answers /api/config with mode "demo" and the page runs on sample data.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const APPLE_PAY_FILE = path.join(ROOT, 'well-known', 'apple-developer-merchantid-domain-association');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MF = {
  token: process.env.MYFATOORAH_TOKEN || '',
  apiUrl: (process.env.MYFATOORAH_API_URL || 'https://apitest.myfatoorah.com').replace(/\/$/, ''),
  scriptUrl: process.env.MYFATOORAH_SCRIPT_URL || 'https://demo.myfatoorah.com/payment/v1/session.js',
};
const VAT_RATE = 0.15;
// MyFatoorah PaymentMethodCode values returned by InitiatePayment.
const CARD_METHOD_CODES = { mada: 'md', card: 'vm' };

// Stand-in for Mehad's orders table. In the platform, load the order by id and check it belongs to the signed-in user.
const order = {
  id: 'ORD-24117',
  teacher: 'Rayyan AL-jaadi',
  student: 'Rayyan Test3',
  sessions: 1,
  text: {
    ar: { packageName: 'الحصة المفردة', subject: 'تأسيس', mode: 'أونلاين', unitLabel: 'حصة' },
    en: { packageName: 'Single session', subject: 'Foundations', mode: 'Online', unitLabel: 'session' },
  },
  price: 100,
  currency: 'SAR',
  promoCode: null,
  status: 'pending',
  invoiceId: null,
};
const VOUCHERS = { VOUCHAR_26: { percent: 99, minTotal: 10 } };

// Customer-facing messages. The page sends its language in the X-Lang header.
const MESSAGES = {
  ar: {
    gateway: 'بوابة الدفع لم تستجب. حاول مرة أخرى بعد قليل.',
    paid: 'تم دفع هذا الطلب مسبقاً.',
    badPromo: 'رمز الخصم غير صحيح أو منتهي.',
    minTotal: (n) => `هذا الرمز صالح للطلبات بقيمة ${n} ريال أو أكثر.`,
    badSession: 'جلسة الدفع غير صالحة.',
    badMethod: 'طريقة الدفع غير مدعومة.',
    methodOff: 'طريقة الدفع هذه غير مفعّلة حالياً. اختر طريقة أخرى.',
    tooLarge: 'الطلب كبير جداً.',
    badJson: 'صيغة الطلب غير صحيحة.',
    notConfigured: 'الدفع غير مفعّل: أضف MYFATOORAH_TOKEN في إعدادات الخادم.',
    notFound: 'المسار غير موجود.',
    notAllowed: 'Method not allowed',
    unexpected: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
  },
  en: {
    gateway: "The payment gateway didn't respond. Please try again shortly.",
    paid: 'This order has already been paid.',
    badPromo: 'This promo code is invalid or has expired.',
    minTotal: (n) => `This code is valid on orders of ${n} SAR or more.`,
    badSession: 'Invalid payment session.',
    badMethod: 'Unsupported payment method.',
    methodOff: 'This payment method is not available right now. Please choose another.',
    tooLarge: 'Request too large.',
    badJson: 'Malformed request.',
    notConfigured: 'Payments are not enabled: set MYFATOORAH_TOKEN on the server.',
    notFound: 'Not found.',
    notAllowed: 'Method not allowed',
    unexpected: 'Something went wrong. Please try again.',
  },
};

function message(lang, key, args = []) {
  const m = MESSAGES[lang][key];
  return typeof m === 'function' ? m(...args) : m;
}

class HttpError extends Error {
  constructor(status, key, ...args) {
    super(key);
    this.status = status;
    this.key = key;
    this.args = args;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

function quote(o) {
  const subtotal = o.price;
  const v = o.promoCode && VOUCHERS[o.promoCode];
  const discount = v && subtotal >= v.minTotal ? round2((subtotal * v.percent) / 100) : 0;
  const total = round2(subtotal - discount);
  return { subtotal, discount, total, vat: round2(total - total / (1 + VAT_RATE)), currency: o.currency };
}

function orderPayload(lang) {
  const { id, teacher, student, sessions } = order;
  return {
    order: { id, teacher, student, sessions, ...order.text[lang] },
    quote: quote(order),
    promoCode: order.promoCode,
    vouchers: Object.entries(VOUCHERS).map(([code, v]) => ({ code, ...v })),
  };
}

async function myfatoorah(endpoint, body) {
  const res = await fetch(`${MF.apiUrl}/v2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MF.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.IsSuccess) {
    const detail = data?.ValidationErrors?.map((e) => `${e.Name}: ${e.Error}`).join(' | ') || data?.Message || res.statusText;
    console.error(`MyFatoorah ${endpoint} failed (${res.status}): ${detail}`);
    throw new HttpError(502, 'gateway');
  }
  return data.Data;
}

function invoiceFields(q, lang) {
  return {
    InvoiceValue: q.total,
    DisplayCurrencyIso: q.currency,
    CustomerName: order.student,
    CustomerReference: order.id,
    Language: lang,
    CallBackUrl: `${PUBLIC_URL}/payment/callback`,
    ErrorUrl: `${PUBLIC_URL}/payment/callback`,
    InvoiceItems: [{ ItemName: order.text[lang].packageName, Quantity: 1, UnitPrice: q.total }],
  };
}

function assertPayable() {
  if (order.status === 'paid') throw new HttpError(409, 'paid');
}

/* ---------- routes ---------- */

const routes = {
  'GET /api/config': () => ({ mode: MF.token ? 'live' : 'demo', scriptUrl: MF.scriptUrl }),

  'GET /api/order': ({ lang }) => orderPayload(lang),

  'POST /api/promo': ({ body, lang }) => {
    assertPayable();
    const code = String(body.code || '').trim().toUpperCase();
    const v = VOUCHERS[code];
    if (!v) throw new HttpError(400, 'badPromo');
    if (order.price < v.minTotal) throw new HttpError(400, 'minTotal', v.minTotal);
    order.promoCode = code;
    return orderPayload(lang);
  },

  'DELETE /api/promo': ({ lang }) => {
    assertPayable();
    order.promoCode = null;
    return orderPayload(lang);
  },

  // Step 1 of Apple Pay: a session the page hands to myfatoorah.init().
  'POST /api/payments/session': async () => {
    assertPayable();
    const q = quote(order);
    const d = await myfatoorah('InitiateSession', {});
    return { sessionId: d.SessionId, countryCode: d.CountryCode, currencyCode: q.currency, amount: q.total };
  },

  // Step 2 of Apple Pay: the customer approved in the Apple Pay sheet; charge the session.
  // Do not send PaymentMethodId here, it overrides SessionId.
  'POST /api/payments/execute': async ({ body, lang }) => {
    assertPayable();
    const sessionId = String(body.sessionId || '');
    if (!/^[\w-]{8,64}$/.test(sessionId)) throw new HttpError(400, 'badSession');
    const d = await myfatoorah('ExecutePayment', { SessionId: sessionId, ...invoiceFields(quote(order), lang) });
    order.invoiceId = d.InvoiceId;
    return { paymentUrl: d.PaymentURL };
  },

  // mada / Visa / Mastercard: send the customer to MyFatoorah's hosted card page.
  'POST /api/payments/redirect': async ({ body, lang }) => {
    assertPayable();
    const code = CARD_METHOD_CODES[body.method];
    if (!code) throw new HttpError(400, 'badMethod');
    const q = quote(order);
    const init = await myfatoorah('InitiatePayment', { InvoiceAmount: q.total, CurrencyIso: q.currency });
    const pm = init.PaymentMethods.find((m) => String(m.PaymentMethodCode).toLowerCase() === code);
    if (!pm) throw new HttpError(400, 'methodOff');
    const d = await myfatoorah('ExecutePayment', { PaymentMethodId: pm.PaymentMethodId, ...invoiceFields(q, lang) });
    order.invoiceId = d.InvoiceId;
    return { paymentUrl: d.PaymentURL };
  },
};

// MyFatoorah sends the customer back here (success and error). Never trust the redirect alone: ask MyFatoorah.
async function paymentCallback(url, res) {
  const paymentId = url.searchParams.get('paymentId');
  let paid = false;
  if (paymentId) {
    try {
      const d = await myfatoorah('GetPaymentStatus', { Key: paymentId, KeyType: 'PaymentId' });
      paid = d.InvoiceStatus === 'Paid'
        && d.CustomerReference === order.id
        && Math.abs(Number(d.InvoiceValue) - quote(order).total) < 0.01;
      if (paid) {
        order.status = 'paid';
        order.invoiceId = d.InvoiceId;
      }
    } catch {
      paid = false;
    }
  }
  res.writeHead(302, { Location: `/result.html?status=${paid ? 'paid' : 'failed'}&ref=${encodeURIComponent(order.id)}` });
  res.end();
}

/* ---------- plumbing ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new HttpError(413, 'tooLarge');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'badJson');
  }
}

async function serveStatic(pathname, res) {
  // Apple Pay domain verification file, downloaded from the MyFatoorah portal.
  if (pathname === '/.well-known/apple-developer-merchantid-domain-association') {
    try {
      const file = await readFile(APPLE_PAY_FILE);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(file);
    } catch {
      res.writeHead(404);
      return res.end();
    }
  }
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  const lang = req.headers['x-lang'] === 'en' ? 'en' : 'ar';
  try {
    if (url.pathname === '/payment/callback') return await paymentCallback(url, res);

    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      if (url.pathname.startsWith('/api/payments') && !MF.token) {
        throw new HttpError(503, 'notConfigured');
      }
      const body = req.method === 'POST' ? await readJson(req) : {};
      return sendJson(res, 200, await handler({ body, url, lang }));
    }
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'notFound');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'notAllowed');
    return await serveStatic(url.pathname, res);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    sendJson(res, status, { error: message(lang, status === 500 ? 'unexpected' : e.key, e.args) });
  }
});

server.listen(PORT, () => {
  console.log(`Mehad checkout on ${PUBLIC_URL} (${MF.token ? 'live: ' + MF.apiUrl : 'demo mode, no MYFATOORAH_TOKEN'})`);
});
