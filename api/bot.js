const TelegramBot = require('node-telegram-bot-api').default;
const axios = require('axios');

const TELEGRAM_TOKEN = '8693741936:AAFLrjJ6iEyvysf6wKexVZ4-rmXYfbcBSws';
const VERCEL_SERVER_URL = 'https://ai-summary-api-eta.vercel.app';

const bot = new TelegramBot(TELEGRAM_TOKEN);
const pendingUrls = {}; // كنخزنو فيها الرابط ملي كنسولو على اللغة

async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.startsWith('/start')) {
        return bot.sendMessage(chatId, "مرحباً بك! صيفط ليا رابط ديال أي مقال وغادي نلخصو ليك ف الحين بالذكاء الاصطناعي.");
    }

    const urlRegex = /^(https?:\/\/[^\s]+)/g;
    if (!urlRegex.test(text)) {
        return bot.sendMessage(chatId, "المرجو إرسال رابط صحيح (URL) للمقال.");
    }

    // نخزنو الرابط ونسولو على اللغة
    pendingUrls[chatId] = text;

    await bot.sendMessage(chatId, "بأي لغة بغيتي التلخيص؟", {
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

async function handleLanguageChoice(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data; // "lang_ar" ولا "lang_en"
    const url = pendingUrls[chatId];

    if (!url) {
        return bot.sendMessage(chatId, "المرجو إرسال الرابط من جديد.");
    }

    const lang = data === "lang_ar" ? "ar" : "en";
    delete pendingUrls[chatId];

    await bot.answerCallbackQuery(callbackQuery.id);
    await bot.sendMessage(chatId, "جاري تحضير التلخيص...");

    try {
        const response = await axios.post(`${VERCEL_SERVER_URL}/api/app`, { url: url, lang: lang });

        if (response.data && response.data.status === 'success') {
            const { summary, title, domain } = response.data;
            const message = `📰 *${title}*\n🔗 المصدر: ${domain}\n\n━━━━━━━━━━━━━━\n\n📝 *التلخيص:*\n\n${summary}\n\n━━━━━━━━━━━━━━`;
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(chatId, `خطأ: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error(error);
        await bot.sendMessage(chatId, `تعذر الاتصال: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
    }
}

module.exports = async (req, res) => {
  try {
    if (req.body && req.body.message) {
      await handleTelegramMessage(req.body.message);
    } else if (req.body && req.body.callback_query) {
      await handleLanguageChoice(req.body.callback_query);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling webhook update:', error);
    res.status(500).send('Internal Server Error');
  }
};