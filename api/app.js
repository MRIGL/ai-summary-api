const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.post('/api/app', async (req, res) => {
    const { url, lang } = req.body;

    if (!url) {
        return res.status(400).json({ error: "Veuillez fournir l'URL du site." });
    }

    try {
        const webResponse = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const htmlContent = webResponse.data;
        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').substring(0, 3000);

        const aiResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: lang === "ar" ? "أنت مساعد ذكاء اصطناعي. لخص هذا النص بوضوح في 4 أسطر باللغة العربية." : "You are an AI assistant. Summarize this text clearly in 4 lines in English." },
                { role: "user", content: plainText }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }
        });

        const summary = aiResponse.data.choices[0].message.content;

        return res.json({ status: "success", summary: summary });

    } catch (error) {
        const errDetail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error("Groq/Scraping Error:", errDetail);
        return res.status(500).json({ error: "Erreur lors du résumé.", detail: errDetail });
    }
});

module.exports = app;