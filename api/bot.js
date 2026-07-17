const TelegramBot = require('node-telegram-bot-api').default;
const axios = require('axios');

const TELEGRAM_TOKEN = '8693741936:AAFLrjJ6iEyvysf6wKexVZ4-rmXYfbcBSws';
const VERCEL_SERVER_URL = 'https://ai-summary-api-eta.vercel.app';

const bot = new TelegramBot(TELEGRAM_TOKEN);
const pendingUrls = {};
const userSessions = {}; // { chatId: { invoiceId, url, lang } }
const userStats = {};

async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.startsWith('/start')) {
        return bot.sendMessage(chatId,
            "🤖 *Summarize AI Bot*\n" +
            "━━━━━━━━━━━━━━\n\n" +
            "مرحباً بك! 👋\n" +
            "صيفط ليا رابط ديال أي مقال وغادي نلخصو ليك ف الحين بالذكاء الاصطناعي.\n\n" +
            "📌 استعمل /help باش تعرف كيفاش تخدم البوت\n" +
            "ℹ️ استعمل /about باش تعرف كثر على البوت",
            { parse_mode: 'Markdown' }
        );
    }

    if (text.startsWith('/help')) {
        return bot.sendMessage(chatId,
            "📖 *كيفاش تستعمل البوت:*\n\n" +
            "1️⃣ صيفط رابط ديال أي مقال إخباري\n" +
            "2️⃣ اختار اللغة اللي بغيتي التلخيص بيها\n" +
            "3️⃣ خلص الفاتورة (Lightning) باش توصلك التلخيص\n\n" +
            "⚡ سريع، دقيق، ومدفوع.",
            { parse_mode: 'Markdown' }
        );
    }

    if (text.startsWith('/about')) {
        return bot.sendMessage(chatId,
            "ℹ️ *عن البوت*\n\n" +
            "بوت ذكي كيلخص المقالات باستعمال الذكاء الاصطناعي (Groq AI).\n\n" +
            "🔧 مبني بـ Node.js\n" +
            "☁️ مستضاف على Vercel\n" +
            "⚡ الدفع عبر Bitcoin Lightning",
            { parse_mode: 'Markdown' }
        );
    }

    const urlRegex = /^(https?:\/\/[^\s]+)/g;
    if (!urlRegex.test(text)) {
        return bot.sendMessage(chatId, "⚠️ المرجو إرسال رابط صحيح (URL) للمقال.");
    }

    pendingUrls[chatId] = text;

    await bot.sendMessage(chatId, "🌐 بأي لغة بغيتي التلخيص؟", {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🇸🇦 العربية", callback_data: "lang_ar" },
                    { text: "🇬🇧 English", callback_data: "lang_en" }
                ]
            ]
        }
    });
}

async function requestSummary(chatId, url, lang, statusMsgId) {
    try {
        const response = await axios.post(`${VERCEL_SERVER_URL}/api/app`, { url, lang }, {
            headers: { 'x-payment-token': userSessions[chatId]?.invoiceId || '' },
            validateStatus: (status) => status < 500
        });

        if (response.status === 402) {
            const invoicePr = response.headers['x-invoice'];
            const invoiceId = response.headers['x-checking-id'];
            userSessions[chatId] = { invoiceId, url, lang };

            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(invoicePr)}`;

            await bot.deleteMessage(chatId, statusMsgId);
            await bot.sendPhoto(chatId, qrCodeUrl, {
                caption: "⚡ امسح هاد الـ QR code بمحفظة Lightning ديالك باش تخلص، ولا دوس مطول على النص تحت باش تنسخو:"
            });
            await bot.sendMessage(chatId, `\`${invoicePr}\``, { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, "🔄 ملي تخلص، عاود صيفط ليا نفس الرابط باش يعطيك التلخيص نيشان!");
            return;
        }

        if (response.data && response.data.status === 'success') {
            const { summary, title, domain, readingTimeMin, compressionRate } = response.data;

            userStats[chatId] = (userStats[chatId] || 0) + 1;
            const articleNumber = userStats[chatId];

            const now = new Date();
            const dateStr = now.toLocaleDateString('ar-MA', { day: 'numeric', month: 'long', year: 'numeric' });
            const timeStr = now.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });

            const message =
                `📰 *${title}*\n` +
                `🔗 المصدر: ${domain}\n` +
                `⏱️ وقت القراءة الأصلي: ~${readingTimeMin} دقيقة\n\n` +
                `━━━━━━━━━━━━━━\n\n` +
                `📝 *التلخيص:*\n\n${summary}\n\n` +
                `━━━━━━━━━━━━━━\n\n` +
                `📊 نسبة الاختصار: ${compressionRate}%\n` +
                `📈 هذا هو المقال رقم ${articleNumber} اللي لخصت ليك\n` +
                `🕐 ${dateStr} - ${timeStr}\n\n` +
                `⚡ Powered by Summarize AI Bot`;

            delete userSessions[chatId];
            await bot.deleteMessage(chatId, statusMsgId);
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔗 افتح المقال الأصلي", url: url }],
                        [{ text: "📄 لخص رابط آخر", callback_data: "new_summary" }]
                    ]
                }
            });
        } else {
            await bot.editMessageText(`❌ خطأ: ${JSON.stringify(response.data)}`, {
                chat_id: chatId,
                message_id: statusMsgId
            });
        }
    } catch (error) {
        console.error(error);
        await bot.editMessageText(`❌ تعذر الاتصال: ${error.response ? JSON.stringify(error.response.data) : error.message}`, {
            chat_id: chatId,
            message_id: statusMsgId
        });
    }
}

async function handleLanguageChoice(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const url = pendingUrls[chatId];

    if (!url) {
        return bot.sendMessage(chatId, "⚠️ المرجو إرسال الرابط من جديد.");
    }

    const lang = data === "lang_ar" ? "ar" : "en";
    delete pendingUrls[chatId];

    await bot.answerCallbackQuery(callbackQuery.id);
    const statusMsg = await bot.sendMessage(chatId, "📥 جاري تحضير طلب التلخيص وفاتورة الدفع...");

    await requestSummary(chatId, url, lang, statusMsg.message_id);
}

async function handleNewSummaryButton(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    await bot.answerCallbackQuery(callbackQuery.id);
    await bot.sendMessage(chatId, "📎 صيفط ليا الرابط ديال المقال الجديد.");
}

module.exports = async (req, res) => {
  try {
    if (req.body && req.body.message) {
      await handleTelegramMessage(req.body.message);
    } else if (req.body && req.body.callback_query) {
      const data = req.body.callback_query.data;
      if (data === "new_summary") {
        await handleNewSummaryButton(req.body.callback_query);
      } else {
        await handleLanguageChoice(req.body.callback_query);
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling webhook update:', error);
    res.status(500).send('Internal Server Error');
  }
};