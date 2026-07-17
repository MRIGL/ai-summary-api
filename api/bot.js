const TelegramBot = require('node-telegram-bot-api').default;
const axios = require('axios');

// ⚠️ التوكن لازم يكون ف environment variable، ماشي مكتوب هنا مباشرة
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
                // 🔑 بدون هاد، axios كيرمي 402 كـ error ومكيوصلش للفرع تاعو تحت
                validateStatus: (status) => status < 500
            }
        );

        if (response.status === 402) {
            const invoicePr = response.headers['x-invoice'] || response.data.paymentRequest;
            const invoiceId = response.headers['x-checking-id'] || response.data.invoiceId;

            // إذا كانت هاي أول مرة (ماكانش عندنا invoiceId قبل)، عرض QR وطلب الدفع
            const isNewInvoice = !session.invoiceId;
            userSessions[chatId] = { ...session, invoiceId };

            if (isNewInvoice) {
                const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(invoicePr)}`;
                await bot.sendPhoto(chatId, qrCodeUrl, {
                    caption: "⚡ امسح هاد الـ QR code بمحفظة Lightning ديالك باش تخلص، ولا دوس مطول على النص تحت باش تنسخو:"
                });
                await bot.sendMessage(chatId, `\`${invoicePr}\``, { parse_mode: 'Markdown' });
                await bot.sendMessage(chatId, "ملي تخلص، دوس زر ✅ تحقق من الدفع.", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ تحقق من الدفع", callback_data: "check_payment" }]]
                    }
                });
            } else {
                // كان عندنا فاتورة أصلاً وعاود جرب "تحقق" بس لسا ماخلصاتش
                await bot.sendMessage(chatId, "الفاتورة مازالت ماخلصاتش. خلص الأول من محفظة Lightning ديالك، وبعدين دوس تحقق.", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ تحقق من الدفع", callback_data: "check_payment" }]]
                    }
                });
            }
        } else if (response.status === 410) {
            await bot.sendMessage(chatId, "الفاتورة صلاحيتها خلصات. صيفط الرابط ديال المقال مرة أخرى باش نديرو وحدة جديدة.");
            delete userSessions[chatId];
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

async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.startsWith('/start')) {
        return bot.sendMessage(chatId, "مرحباً بك! صيفط ليا رابط ديال أي مقال وغادي نلخصو ليك ف الحين بالذكاء الاصطناعي.");
    }

    const urlRegex = /^(https?:\/\/[^\s]+)/;
    if (!urlRegex.test(text)) {
        return bot.sendMessage(chatId, "المرجو إرسال رابط صحيح (URL) للمقال.");
    }

    // خزّن الرابط وسولو على اللغة (فاتورة جديدة كل مرة، بلا invoiceId قديم)
    userSessions[chatId] = { url: text, lang: null, invoiceId: null };

    return bot.sendMessage(chatId, "بأي لغة بغيتي التلخيص؟", {
        reply_markup: {
            inline_keyboard: [[
                { text: "🇸🇦 العربية", callback_data: "lang_ar" },
                { text: "🇬🇧 English", callback_data: "lang_en" }
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
            return bot.sendMessage(chatId, "صيفط ليا رابط المقال باش نبدأو.");
        }
        session.lang = data === 'lang_ar' ? 'ar' : 'en';
        await bot.sendMessage(chatId, "جاري تحضير طلب التلخيص وفاتورة الدفع...");
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