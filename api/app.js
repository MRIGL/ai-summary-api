const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// جلب المفاتيح السرية من إعدادات Vercel (Environment Variables)
const SWISS_API_KEY = process.env.SWISS_API_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// قاعدة بيانات مؤقتة ف الذاكرة لتتبع الفواتير
const pendingInvoices = {};

app.post('/api/app', async (req, res) => {
    const { url } = req.body; 
    const paymentToken = req.headers['x-payment-token']; 

    if (!url) {
        return res.status(400).json({ error: "Veuillez fournir l'URL du site." });
    }

    if (paymentToken && pendingInvoices[paymentToken] && pendingInvoices[paymentToken].paid) {
        try {
            const webResponse = await axios.get(url);
            const htmlContent = webResponse.data;
            const plainText = htmlContent.replace(/<[^>]*>/g, ' ').substring(0, 3000); 

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

            return res.json({ status: "success", summary: summary });

        } catch (error) {
            console.error("Groq/Scraping Error:", error);
            return res.status(500).json({ error: "Erreur lors du résumé." });
        }
    }

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
        return res.status(402).send('Payment Required! Pay the Lightning invoice.');

    } catch (err) {
        const errorDetail = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error("Swiss Bitcoin Pay Error:", errorDetail);
        return res.status(500).json({ error: "Erreur de paiement.", detail: errorDetail });
    }
});

app.post('/api/webhook/payment', (req, res) => {
    const { id, status } = req.body;
    if (status === 'paid' && pendingInvoices[id]) {
        pendingInvoices[id].paid = true; 
    }
    res.sendStatus(200);
});

module.exports = app;