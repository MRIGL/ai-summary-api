const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// جلب المفاتيح السرية من إعدادات Vercel (Environment Variables)
const SWISS_API_KEY = process.env.SWISS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// قاعدة بيانات مؤقتة ف الذاكرة لتتبع الفواتير
// ⚠️ ملاحظة: هاد الكائن بينمسح كل مرة يعيد فيها Vercel تشغيل الـ serverless function.
// إذا بدك حل ثابت (production) لازم تستخدم قاعدة بيانات حقيقية (Redis, Postgres..) بدل الذاكرة.
const pendingInvoices = {};

// ------------------------------------------------------------------
// Helper: إنشاء فاتورة جديدة عبر Swiss Bitcoin Pay
// ------------------------------------------------------------------
async function createInvoice(res) {
    try {
        const swissResponse = await axios.post('https://api.swiss-bitcoin-pay.ch/checkout', {
            amount: 0.01,
            unit: "EUR",
            title: "AI Text Summarization Service",
            description: "Résumé d'article par IA"
        }, {
            headers: { 'api-key': SWISS_API_KEY, 'Content-Type': 'application/json' }
        });

        const invoiceId = swissResponse.data.id;
        const invoicePr = swissResponse.data.pr;

        pendingInvoices[invoiceId] = { paid: false };

        res.setHeader('X-Invoice', invoicePr);
        res.setHeader('X-Checking-Id', invoiceId);
        return res.status(402).json({
            error: "Payment Required",
            message: "Pay the Lightning invoice to continue.",
            invoiceId,
            paymentRequest: invoicePr
        });
    } catch (err) {
        const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
        const keyPreview = SWISS_API_KEY ? SWISS_API_KEY.substring(0, 6) + "..." : "MISSING";
        console.error("Swiss Bitcoin Pay Error:", errorDetail);
        return res.status(500).json({
            error: "Erreur de paiement.",
            detail: errorDetail,
            keyUsed: keyPreview,
            status: err.response ? err.response.status : null
        });
    }
}

// ------------------------------------------------------------------
// Route رئيسي: التلخيص
// ------------------------------------------------------------------
app.post('/api/app', async (req, res) => {
    const { url, lang } = req.body;
    const paymentToken = req.headers['x-payment-token']; // هون بنستخدمه = invoiceId

    if (!url) {
        return res.status(400).json({ error: "Veuillez fournir l'URL du site." });
    }

    // 1) تحقق من الدفع
    const invoice = paymentToken ? pendingInvoices[paymentToken] : null;

    if (!invoice) {
        // ما في فاتورة أصلاً بهاد التوكن → أنشئ وحدة جديدة
        return createInvoice(res);
    }

    if (!invoice.paid) {
        // في فاتورة بس لسا ما انسددت
        return res.status(402).json({ error: "Invoice not paid yet.", invoiceId: paymentToken });
    }

    // 2) الدفع تم → نفذ التلخيص
    try {
        const webResponse = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const htmlContent = webResponse.data;

        const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1].trim() : "بلا عنوان";

        const domain = new URL(url).hostname.replace('www.', '');

        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000);

        const wordCount = plainText.split(/\s+/).length;
        const readingTimeMin = Math.max(1, Math.round(wordCount / 200));

        const aiResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: lang === "ar"
                        ? "لخص هذا النص في 4 أسطر بالضبط باللغة العربية. أعط التلخيص مباشرة بدون أي مقدمة أو عبارات مثل 'هذا ملخص' أو 'فيما يلي'. ابدأ مباشرة بالمحتوى."
                        : "Summarize this text in exactly 4 lines in English. Give the summary directly without any introduction or phrases like 'Here is a summary' or 'Summary:'. Start directly with the content."
                },
                { role: "user", content: plainText }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }
        });

        const summary = aiResponse.data.choices[0].message.content;
        const summaryWordCount = summary.split(/\s+/).length;
        const compressionRate = Math.round((1 - summaryWordCount / wordCount) * 100);

        // فك حجز الفاتورة بعد الاستخدام (Single-use)
        delete pendingInvoices[paymentToken];

        return res.json({
            status: "success",
            summary: summary,
            title: pageTitle,
            domain: domain,
            readingTimeMin: readingTimeMin,
            originalWords: wordCount,
            summaryWords: summaryWordCount,
            compressionRate: compressionRate > 0 ? compressionRate : 0
        });

    } catch (error) {
        const errDetail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error("Groq/Scraping Error:", errDetail);
        return res.status(500).json({ error: "Erreur lors du résumé.", detail: errDetail });
    }
});

// ------------------------------------------------------------------
// Webhook: يستقبل تأكيد الدفع من Swiss Bitcoin Pay
// ------------------------------------------------------------------
app.post('/api/webhook/payment', (req, res) => {
    const { id, status } = req.body;
    if (status === 'paid' && pendingInvoices[id]) {
        pendingInvoices[id].paid = true;
    }
    res.sendStatus(200);
});

module.exports = app;