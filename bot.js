const TelegramBot = require('node-telegram-bot-api').default;
const axios = require('axios');

const TELEGRAM_TOKEN = '8693741936:AAFLrjJ6iEyvysf6wKexVZ4-rmXYfbcBSws';
const VERCEL_SERVER_URL = 'https://ai-summary-api-eta.vercel.app'; // ⚠️ حطي رابط فيرسيل ديالك هنا

// 🛑 هنا ردينا البوت يخدم بـ Webhook ماشي Polling
const bot = new TelegramBot(TELEGRAM_TOKEN);

const userSessions = {};

// دالة لمعالجة الميساجات اللي كتجي من تيليغرام
async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.startsWith('/start')) {
        return bot.sendMessage(chatId, "مرحباً بك! 👋 صيفط ليا رابط ديال أي مقال وغادي نلخصو ليك ف الحين بالذكاء الاصطناعي.");
    }

    const urlRegex = /^(https?:\/\/[^\s]+)/g;
    if (!urlRegex.test(text)) {
        return bot.sendMessage(chatId, "المرجو إرسال رابط صحيح (URL) للمقال.");
    }

    bot.sendMessage(chatId, "⏳ جاري تحضير طلب التلخيص وفاتورة الدفع...");

    try {
        const response = await axios.post(`${VERCEL_SERVER_URL}/api/app`, { url: text }, {
            headers: { 'x-payment-token': userSessions[chatId]?.invoiceId || '' },
            validateStatus: (status) => status < 500
        });

        if (response.status === 402) {
            const invoicePr = response.headers['x-invoice'];
            const invoiceId = response.headers['x-checking-id'];
            userSessions[chatId] = { invoiceId: invoiceId, url: text };

            await bot.sendMessage(chatId, `⚡ المرجو دفع الفاتورة للتلخيص:\n\n\`${invoicePr}\``, { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, "🔄 ملي تخلص، عاود صيفط ليا نفس الرابط باش يعطيك التلخيص نيشان!");
        } else if (response.data && response.data.status === 'success') {
            await bot.sendMessage(chatId, `📝 **التلخيص:**\n\n${response.data.summary}`, { parse_mode: 'Markdown' });
            delete userSessions[chatId];
        } else {
            await bot.sendMessage(chatId, "❌ حدث خطأ ما ف السيرفر.");
        }
    } catch (error) {
        console.error(error);
        await bot.sendMessage(chatId, "❌ تعذر الاتصال بالسيرفر حالياً.");
    }
}

module.exports = async (req, res) => {
  try {
    if (req.body) {
      await bot.handleUpdate(req.body);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(500).send('Internal Server Error');
  }
};