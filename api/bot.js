const TelegramBot = require('node-telegram-bot-api').default;
const axios = require('axios');

const TELEGRAM_TOKEN = '8693741936:AAFLrjJ6iEyvysf6wKexVZ4-rmXYfbcBSws';
const VERCEL_SERVER_URL = 'https://ai-summary-api-eta.vercel.app';

const bot = new TelegramBot(TELEGRAM_TOKEN);
const userSessions = {};

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

    bot.sendMessage(chatId, "جاري تحضير طلب التلخيص وفاتورة الدفع...");

    try {
        const response = await axios.post(`${VERCEL_SERVER_URL}/api/app`, { url: text }, {
            headers: { 'x-payment-token': userSessions[chatId]?.invoiceId || '' },
            validateStatus: (status) => status < 500
        });

        if (response.status === 402) {
            const invoicePr = response.headers['x-invoice'];
            const invoiceId = response.headers['x-checking-id'];
            userSessions[chatId] = { invoiceId: invoiceId, url: text };

            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(invoicePr)}`;

            await bot.sendPhoto(chatId, qrCodeUrl, {
                caption: "⚡ امسح هاد الـ QR code بمحفظة Lightning ديالك باش تخلص، ولا دوس مطول على النص تحت باش تنسخو:"
            });
            await bot.sendMessage(chatId, `\`${invoicePr}\``, { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, "ملي تخلص، عاود صيفط ليا نفس الرابط باش يعطيك التلخيص نيشان!");
        } else if (response.data && response.data.status === 'success') {
            await bot.sendMessage(chatId, `التلخيص:\n\n${response.data.summary}`, { parse_mode: 'Markdown' });
            delete userSessions[chatId];
        } else {
    console.log("FULL RESPONSE:", JSON.stringify(response.data));
    await bot.sendMessage(chatId, `الحالة: ${response.status} - راجع الـ logs`);
}
    } catch (error) {
        console.error(error);
        await bot.sendMessage(chatId, "تعذر الاتصال بالسيرفر حالياً.");
    }
}

module.exports = async (req, res) => {
  try {
    if (req.body && req.body.message) {
      await handleTelegramMessage(req.body.message);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling webhook update:', error);
    res.status(500).send('Internal Server Error');
  }
};