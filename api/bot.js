const TelegramBot = require('node-telegram-bot-api').default;
const axios = require('axios');

// ⚠️ Token must come from an environment variable, never hardcoded here
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const VERCEL_SERVER_URL = 'https://ai-summary-api-eta.vercel.app';

const bot = new TelegramBot(TELEGRAM_TOKEN);

// userSessions[chatId] = { url, lang, invoiceId }
const userSessions = {};

async function requestSummary(chatId) {
    const session = userSessions[chatId];
    if (!session || !session.url || !session.lang) return;

    try {
        const response = await axios.post(
            `${VERCEL_SERVER_URL}/api/app`,
            { url: session.url, lang: session.lang },
            {
                headers: { 'x-payment-token': session.invoiceId || '' },
                // 🔑 Without this, axios throws 402 as an error instead of letting us handle it below
                validateStatus: (status) => status < 500
            }
        );

        if (response.status === 402) {
            const invoicePr = response.headers['x-invoice'] || response.data.paymentRequest;
            const invoiceId = response.headers['x-checking-id'] || response.data.invoiceId;

            // First time we see this invoice → show QR and payment request
            const isNewInvoice = !session.invoiceId;
            userSessions[chatId] = { ...session, invoiceId };

            if (isNewInvoice) {
                const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(invoicePr)}`;
                await bot.sendPhoto(chatId, qrCodeUrl, {
                    caption: "⚡ Scan this QR code with your Lightning wallet to pay, or long-press the text below to copy it:"
                });
                await bot.sendMessage(chatId, `\`${invoicePr}\``, { parse_mode: 'Markdown' });
                await bot.sendMessage(chatId, "Once you've paid, tap ✅ Check Payment.", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ Check Payment", callback_data: "check_payment" }]]
                    }
                });
            } else {
                // We already had this invoice and the user tapped "check" again, but it's still unpaid
                await bot.sendMessage(chatId, "This invoice hasn't been paid yet. Pay it with your Lightning wallet first, then check again.", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ Check Payment", callback_data: "check_payment" }]]
                    }
                });
            }
        } else if (response.status === 410) {
            await bot.sendMessage(chatId, "This invoice has expired. Send me the article link again to generate a new one.");
            delete userSessions[chatId];
        } else if (response.data && response.data.status === 'success') {
            await bot.sendMessage(chatId, `Summary:\n\n${response.data.summary}`, { parse_mode: 'Markdown' });
            delete userSessions[chatId];
        } else {
            console.log("FULL RESPONSE:", JSON.stringify(response.data));
            await bot.sendMessage(chatId, `Status: ${response.status} - check the logs`);
        }
    } catch (error) {
        console.error(error);
        await bot.sendMessage(chatId, "Couldn't reach the server right now. Please try again in a bit.");
    }
}

async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.startsWith('/start')) {
        const welcomeMsg =
            "👋 Welcome!\n\n" +
            "🤖 This bot summarizes any article, news piece, or text using AI, in 4 clear lines, in Arabic or English.\n\n" +
            "💰 Price: €0.01 per summary, paid via Bitcoin Lightning (fast and secure, no bank card needed).\n\n" +
            "📌 How it works:\n" +
            "1️⃣ Send me the article link\n" +
            "2️⃣ Choose a language\n" +
            "3️⃣ Pay by scanning the QR code\n" +
            "4️⃣ Get your summary in seconds ⚡\n\n" +
            "Try it now: send me any article link 👇";
        return bot.sendMessage(chatId, welcomeMsg);
    }

    const urlRegex = /^(https?:\/\/[^\s]+)/;
    if (!urlRegex.test(text)) {
        return bot.sendMessage(chatId, "Please send a valid article URL.");
    }

    // Store the URL and ask for the summary language (fresh invoice each time, no stale invoiceId)
    userSessions[chatId] = { url: text, lang: null, invoiceId: null };

    return bot.sendMessage(chatId, "Which language would you like the summary in?", {
        reply_markup: {
            inline_keyboard: [[
                { text: "🇬🇧 English", callback_data: "lang_en" },
                { text: "🇸🇦 Arabic", callback_data: "lang_ar" }
            ]]
        }
    });
}

async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id).catch(() => {});

    if (data === 'lang_ar' || data === 'lang_en') {
        const session = userSessions[chatId];
        if (!session || !session.url) {
            return bot.sendMessage(chatId, "Send me an article link to get started.");
        }
        session.lang = data === 'lang_ar' ? 'ar' : 'en';
        await bot.sendMessage(chatId, "Preparing your summary request and payment invoice...");
        return requestSummary(chatId);
    }

    if (data === 'check_payment') {
        return requestSummary(chatId);
    }
}

module.exports = async (req, res) => {
    try {
        if (req.body && req.body.message) {
            await handleTelegramMessage(req.body.message);
        } else if (req.body && req.body.callback_query) {
            await handleCallbackQuery(req.body.callback_query);
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error handling webhook update:', error);
        res.status(500).send('Internal Server Error');
    }
};