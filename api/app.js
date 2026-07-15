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

        const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1].trim() : "بلا عنوان";

        const domain = new URL(url).hostname.replace('www.', '');

        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000);

        // حساب عدد الكلمات ووقت القراءة
        const wordCount = plainText.split(/\s+/).length;
        const readingTimeMin = Math.max(1, Math.round(wordCount / 200));

        const aiResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: lang === "ar" ? "لخص هذا النص في 4 أسطر بالضبط باللغة العربية. أعط التلخيص مباشرة بدون أي مقدمة أو عبارات مثل 'هذا ملخص' أو 'فيما يلي'. ابدأ مباشرة بالمحتوى." : "Summarize this text in exactly 4 lines in English. Give the summary directly without any introduction or phrases like 'Here is a summary' or 'Summary:'. Start directly with the content." },
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
});

module.exports = app;