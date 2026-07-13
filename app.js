const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// ⚠️ مسحي هاد الجملة وحطي الكود السرّي ديالك من Swiss Bitcoin Pay
const SWISS_API_KEY = process.env.SWISS_API_KEY; 

// ⚠️ مسحي هاد الجملة وحطي الكود السرّي ديالك من Groq (لي بادي بـ gsk)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// قاعدة بيانات مؤقتة ف الذاكرة لتتبع الفواتير
const pendingInvoices = {};

// هاد الرابط هو اللي غايقصدو الروبوت باش يلخص المقالات
app.post('/api/summarize', async (req, res) => {
    const { url } = req.body; // الروبوت كيسيفط رابط المقال هنا
    const paymentToken = req.headers['x-payment-token']; // دليل الخلاص

    if (!url) {
        return res.status(400).json({ error: "Veuillez fournir l'URL du site." });
    }

    // 1. واش الروبوت ديجا خلص وسيفط الـ Token؟
    if (paymentToken && pendingInvoices[paymentToken] && pendingInvoices[paymentToken].paid) {
        try {
            // أ. جلب محتوى الموقع (تنظيف خفيف للـ HTML)
            const webResponse = await axios.get(url);
            const htmlContent = webResponse.data;
            const plainText = htmlContent.replace(/<[^>]*>/g, ' ').substring(0, 3000); 

            // ب. إرسال النص للـ AI باش يلخصو
            const aiResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama3-8b-8192",
                messages: [
                    { role: "system", content: "Tu es un assistant IA. Résume ce texte de manière claire en 4 lignes maximum." },
                    { role: "user", content: plainText }
                ]
            }, {
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }
            });

            const summary = aiResponse.data.choices[0].message.content;

            // ج. نردوا النتيجة للروبوت
            return res.json({ status: "success", summary: summary });

        } catch (error) {
            return res.status(500).json({ error: "Erreur lors du résumé." });
        }
    }

    // 2. يلا مازال ماخلصش، نطلبو ليه فاتورة من Swiss Bitcoin Pay
    try {
        const swissResponse = await axios.post('https://api.swiss-bitcoin-pay.ch/v1/invoice', {
            amount: 0.002, // الثمن هو 2 د المليون من الدولار لكل طلب
            currency: "Euro",
            description: "AI Text Summarization Service"
        }, {
            headers: { 'Api-Key': SWISS_API_KEY, 'Content-Type': 'application/json' }
        });

        const invoiceId = swissResponse.data.id;
        const invoicePr = swissResponse.data.paymentRequest; // كود اللايتنينغ

        // نقيدوها عندنا بلي باقا ما تخلصاتش
        pendingInvoices[invoiceId] = { paid: false };

        // نردوا كود 402 للروبوت ونعطيوه الفاتورة ف الـ Headers
        res.setHeader('X-Invoice', invoicePr);
        res.setHeader('X-Checking-Id', invoiceId);
        return res.status(402).send('Payment Required! Pay the Lightning invoice.');

    } catch (err) {
        return res.status(500).send("Erreur de paiement.");
    }
});

// هاد البلاصة كتعيط ليها بوابة الدفع ملي الروبوت كيخلص بصح (Webhook)
app.post('/api/webhook/payment', (req, res) => {
    const { id, status } = req.body;
    if (status === 'paid' && pendingInvoices[id]) {
        pendingInvoices[id].paid = true; // كترجع تخلصات!
    }
    res.sendStatus(200);
});

app.get('/status', (req, res) => {
    res.json({ status: "online", message: "السيرفر شغال وناضي 🚀" });
});

app.listen(3000, () => console.log('🚀 السيرفر واجد وخدام على البورت 3000!'));