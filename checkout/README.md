# صفحة الدفع في مهاد (نموذج أولي)

نسخة جديدة من صفحة «إتمام الشراء» بتخطيط صفحة دفع الرحيق وهوية مهاد، مع إضافة **Apple Pay** عبر ماي فاتورة.
على الآيفون، عندما يختار العميل Apple Pay ويضغط الزر تظهر نافذة Apple Pay الأصلية (البطاقة، بيانات التواصل، المبلغ، «Confirm with Side Button»).

```
checkout/
├── server.mjs          خادم Node بدون مكتبات: يعرض الصفحة ويتصل بماي فاتورة (المفتاح يبقى في الخادم)
├── public/
│   ├── index.html      الصفحة
│   ├── checkout.css    التصميم (فاتح، RTL)
│   ├── checkout.js     منطق الصفحة و Apple Pay
│   └── result.html     صفحة نتيجة الدفع
├── well-known/         ضع هنا ملف التحقق من Apple Pay (انظر أدناه)
└── .env.example
```

## التشغيل

```bash
cd checkout
npm start                      # وضع المعاينة: بيانات تجريبية بدون أي خصم
# أو مع بيئة اختبار ماي فاتورة:
MYFATOORAH_TOKEN=xxxx PUBLIC_URL=https://your-domain npm start
```

افتح `http://localhost:3000`. بدون `MYFATOORAH_TOKEN` تعمل الصفحة في **وضع المعاينة**: تُعرض بيانات تجريبية ولا يتم أي خصم. مع Apple Pay تظهر **نسخة محاكاة** من نافذة Apple Pay (البطاقة، التواصل، المبلغ، «Confirm with Side Button») حتى تشوف التجربة على أي جهاز؛ على الموقع الفعلي يرسم iOS النافذة الأصلية بنفسه بدل المحاكاة. ومع مدى أو فيزا تظهر رسالة تشرح التحويل لصفحة الدفع.

## ترتيب الصفحة

0. **شريط علوي** أبيض: زر رجوع وشعار مهاد، وتحته العنوان «إتمام الشراء» وقائمة العملة (SAR / USD).
   الدولار **للعرض فقط** (السعر الثابت ٣٫٧٥ ريال للدولار)، والدفع دائماً بالريال، وتظهر ملاحظة بذلك تحت الإجمالي. العملة المختارة تُحفظ في المتصفح.
1. **ملخص الطلب**: اسم الباقة، المادة وطريقة التعليم، السعر، و«١ × حصة» تفتح التفاصيل (المعلم، الطالب، المادة، طريقة التعليم، عدد الحصص).
2. **ملخص الدفع**: «أضف رمز خصم» مع القسائم المتاحة، ثم إيصال بحواف متموجة: المجموع الفرعي، الخصم، ضريبة القيمة المضافة ١٥٪ (مشمولة)، الإجمالي.
3. **طريقة الدفع**: Apple Pay (فقط على أجهزة أبل المدعومة)، مدى، فيزا/ماستركارد.
4. **شريط دفع ثابت** في الأسفل: الإجمالي و«شامل الضريبة» وزر «ادفع الآن» نفسه مع كل الطرق؛ إذا كان Apple Pay مختاراً يفتح الزر نافذة Apple Pay مباشرة.

Apple Pay **ظاهر دائماً**. على أجهزة أبل المدعومة يكون الخيار الافتراضي، وعلى غيرها (أندرويد، كروم على ويندوز...) تكون مدى هي الافتراضية، وإذا اختار العميل Apple Pay وضغط «ادفع الآن» تظهر له رسالة تطلب اختيار مدى أو فيزا.

## كيف يعمل Apple Pay

يستخدم الدفع المدمج من ماي فاتورة (`session.js`) مع زرنا الخاص:

| الخطوة | أين | ماذا يحدث |
|---|---|---|
| ١ | الخادم `POST /api/payments/session` | `InitiateSession` ← `SessionId` و `CountryCode` |
| ٢ | المتصفح | `myfatoorah.init({... paymentOptions: ["ApplePay"], settings.applePay.useCustomButton: true })` |
| ٣ | المتصفح عند الضغط على «ادفع الآن» | `myfatoorah.initApplePayPayment()` ← تظهر نافذة Apple Pay الأصلية |
| ٤ | المتصفح | بعد التأكيد يُستدعى `callback` ← نرسل `sessionId` للخادم |
| ٥ | الخادم `POST /api/payments/execute` | `ExecutePayment` بالـ `SessionId` والمبلغ المحسوب **في الخادم** ← `PaymentURL` |
| ٦ | المتصفح | التحويل إلى `PaymentURL` ← ماي فاتورة تعيد العميل إلى `/payment/callback` |
| ٧ | الخادم `/payment/callback` | `GetPaymentStatus` للتأكد أن الحالة `Paid` وأن المرجع والمبلغ مطابقان، ثم `result.html` |

مدى وفيزا/ماستركارد: `InitiatePayment` لمعرفة رقم الطريقة (`md` لمدى، `vm` لفيزا/ماستر) ثم `ExecutePayment` وتحويل العميل لصفحة الدفع الآمنة في ماي فاتورة.

ملاحظات مهمة في الكود:
- `initApplePayPayment()` يُستدعى مباشرة داخل حدث الضغط بدون أي `await` قبله، وإلا يرفض Safari فتح النافذة.
- لا ترسل `PaymentMethodId` مع `SessionId` في `ExecutePayment` لأنه يلغي الجلسة.
- عند تغيير المبلغ (رمز خصم) يُستدعى `myfatoorah.updateAmount()` حتى يظهر المبلغ الصحيح في نافذة Apple Pay.
- الجلسة تُستخدم مرة واحدة؛ إذا فشل التنفيذ تُجهَّز جلسة جديدة تلقائياً.

## تفعيل Apple Pay (مطلوب قبل أن تظهر النافذة على الموقع الحقيقي)

1. اطلب من ماي فاتورة تفعيل **Apple Pay (Embedded)** على حسابك.
2. من بوابة ماي فاتورة نزّل ملف التحقق `apple-developer-merchantid-domain-association` وضعه في `checkout/well-known/`. الخادم يقدّمه على:
   `https://your-domain/.well-known/apple-developer-merchantid-domain-association`
3. سجّل الدومين (مثل `mehad.sa`) في إعدادات Apple Pay في بوابة ماي فاتورة. كل دومين أو دومين فرعي يحتاج تسجيلاً مستقلاً.
4. الموقع لازم يعمل على **HTTPS**.
5. للانتقال للتشغيل الفعلي في السعودية غيّر في `.env`:
   `MYFATOORAH_API_URL=https://api-sa.myfatoorah.com` و `MYFATOORAH_SCRIPT_URL=https://sa.myfatoorah.com/payment/v1/session.js`

الاسم الذي يظهر في نافذة Apple Pay («Pay Mehad (via MyFatoorah)») يأتي من اسم حسابك في ماي فاتورة.

## نقلها إلى كود منصة مهاد

- **الواجهة**: `index.html` و `checkout.css` و `checkout.js` مستقلة؛ حوّل الأقسام إلى مكونات (React/Vue...) واحتفظ بنفس الـ IDs أو مرّر العناصر بالـ refs. الألوان كلها متغيرات في `:root` أعلى ملف CSS.
- **الخادم**: انقل المسارات في `server.mjs` إلى الـ API عندكم. استبدل الكائن `order` الثابت بقراءة الطلب من قاعدة البيانات **والتحقق أنه يخص المستخدم المسجل**، واستبدل `VOUCHERS` بجدول القسائم.
- **مهم**: المبلغ يُحسب دائماً في الخادم، ولا يُعتمد على أي مبلغ يرسله المتصفح.
- يُفضَّل إضافة **Webhook** من ماي فاتورة لتأكيد الدفع حتى لو أغلق العميل الصفحة قبل الرجوع.
- شعارات مدى وفيزا/ماستركارد في النموذج مبسّطة؛ استبدلها بالشعارات الرسمية قبل الإطلاق.

المرجع: [MyFatoorah Embedded Payment](https://docs.myfatoorah.com/docs/embedded-integration-steps) · [تخصيص Apple Pay](https://docs.myfatoorah.com/docs/unified-session-customization)

رمز الريال السعودي من [Saudi-Riyal-Font](https://github.com/emran-alhaddad/Saudi-Riyal-Font) (رخصة SIL OFL 1.1، انظر `public/riyal-symbol-OFL.txt`).
