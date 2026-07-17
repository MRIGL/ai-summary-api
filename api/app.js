const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SWISS_API_KEY = process.env.SWISS_API_KEY;

app.post('/api/app', async (req, res) => {
    const { url, lang } = req.body;
    const paymentToken = req.headers['x-payment-token'];

    if (!url) {
        return res.status(400).json({ error: "Veuillez fournir l'URL du site." });
    }

    // 1) إذا كان عندنا invoiceId، نتحقق من حالته مباشرة عند Swiss Bitcoin Pay
    //    (بدل الاعتماد على ذاكرة السيرفر أو webhook، اللي ممكن تنمسح أو ما توصلش)
    if (paymentToken) {
        try {
            const checkResponse = await axios.get(`https://api.swiss-bitcoin-pay.ch/checkout/${paymentToken}`);
            const invoice = checkResponse.data;

            if (invoice.isExpired) {
                return res.status(410).json({ error: "Invoice expired.", invoiceId: paymentToken });
            }

            if (invoice.isPaid) {
                // الدفع مؤكد → ننفذ التلخيص
                return await performSummary(url, lang, res);
            }

            // الفاتورة موجودة بس لسا ما انخلصتش
            return res.status(402).json({ error: "Invoice not paid yet.", invoiceId: paymentToken });

        } catch (err) {
            const errDetail = err.response ? JSON.stringify(err.response.data) : err.message;
            console.error("Swiss Bitcoin Pay check error:", errDetail);
            return res.status(500).json({ error: "Erreur de vérification du paiement.", detail: errDetail });
        }
    }

    // 2) ما في invoiceId أصلاً → ننشئ فاتورة جديدة
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
        console.error("Swiss Bitcoin Pay Error:", errorDetail);
        return res.status(500).json({ error: "Erreur de paiement.", detail: errorDetail });
    }
});

// ------------------------------------------------------------------
// تنفيذ التلخيص الفعلي (بعد التأكد من الدفع)
// ------------------------------------------------------------------
async function performSummary(url, lang, res) {
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
                        ? "لخص هذا النص في 4 أسطر بالضبط باللغة العربية الفصحى السليمة، بأسلوب واضح ومصحح لغويًا ونحويًا بشكل كامل. أعط التلخيص مباشرة بدون أي مقدمة أو عبارات مثل 'هذا ملخص' أو 'فيما يلي'. ابدأ مباشرة بالمحتوى."
                        : "Summarize this text in exactly 4 lines in clear, grammatically correct, well-polished English. Give the summary directly without any introduction or phrases like 'Here is a summary' or 'Summary:'. Start directly with the content."
                },
                { role: "user", content: plainText }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }
        });

        const summary = aiResponse.data.choices[0].message.content;
        const summaryWordCount = summary.split(/\s+/).length;
        const compressionRate = Math.round((1 - summaryWordCount / wordCount) * 100);

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
}

module.exports = app;