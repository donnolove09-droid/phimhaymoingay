const crypto = require('crypto');
const querystring = require('querystring');
const axios = require('axios');
const QRCode = require('qrcode');
const Order = require('../models/Order');
const AccessKey = require('../models/AccessKey');
const PLANS = require('../config/plans');
const { allocateKey } = require('../services/keys');
const { publicUrl } = require('../config/env');

function genOrderCode() {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `DH${ts}${rand}`;
}

function formatPrice(p) {
    return p === 0 ? 'Miễn phí' : p.toLocaleString('vi-VN') + 'đ';
}

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

/** Gói trả phí hợp lệ. Gói miễn phí KHÔNG được tạo đơn qua đường này (xem trialToken). */
function getPaidPlan(plan) {
    const info = PLANS[plan];
    if (!info) throw new HttpError(400, 'Gói không hợp lệ');
    if (info.price === 0) throw new HttpError(400, 'Gói miễn phí hãy lấy bằng lệnh /getkeyfree trên Telegram');
    return info;
}

async function notifyTelegram(chatId, html) {
    try {
        const { notify } = require('../bot');
        if (chatId) await notify(chatId, html);
    } catch (e) { console.error('[telegram] notify:', e.message); }
}

async function deliverKey(order) {
    if (order.status === 'delivered') return order;

    const key = await allocateKey(`order:${order.orderCode}`, {
        note: `Order ${order.orderCode} - ${order.plan}`,
        plan: order.plan,
        durationHours: order.durationHours
    });

    if (!key) {
        if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
            await notifyTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, `⚠️ Hết key! Order <code>${order.orderCode}</code> đã thanh toán nhưng chưa giao.`);
        }
        return null;
    }

    // Chuyển trạng thái atomic: nếu webhook & admin cùng xác nhận 1 lúc thì chỉ 1 bên thắng
    const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: { $ne: 'delivered' } },
        { $set: { status: 'delivered', keyId: key._id, keyValue: key.key, deliveredAt: new Date() } },
        { new: true }
    );
    if (!updated) {
        await AccessKey.updateOne({ _id: key._id }, { $set: { issuedTo: null } });   // trả key lại kho
        return Order.findById(order._id);
    }
    Object.assign(order, updated.toObject());

    await notifyTelegram(order.chatId,
        `<b>Thanh toán thành công</b>\n\n` +
        `Mã đơn: <code>${order.orderCode}</code>\n` +
        `Gói: <b>${PLANS[order.plan]?.name || order.plan}</b>\n` +
        `Thời hạn: <b>${order.durationHours}h</b>\n\n` +
        `Key của bạn:\n<code>${key.key}</code>\n\n` +
        `Vào website nhập key để xem phim.`);
    if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
        await notifyTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID,
            `<b>Đơn hoàn tất</b>\nMã: <code>${order.orderCode}</code>\nGói: ${order.plan} — ${formatPrice(order.price)}\nKey: <code>${key.key}</code>`);
    }
    return order;
}

/* ---------- Các hàm tạo đơn (dùng chung cho HTTP và bot Telegram) ---------- */
async function createVietQROrder({ plan, chatId, email }) {
    const planInfo = getPaidPlan(plan);
    const order = await Order.create({
        orderCode: genOrderCode(),
        chatId: chatId || null,
        customerEmail: email || null,
        plan,
        durationHours: planInfo.durationHours,
        price: planInfo.price,
        paymentMethod: 'vietqr',
        status: 'pending'
    });

    const qrUrl =
        `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-` +
        `${process.env.BANK_TEMPLATE || 'compact2'}.png?amount=${planInfo.price}` +
        `&addInfo=${encodeURIComponent(order.orderCode)}` +
        `&accountName=${encodeURIComponent(process.env.BANK_ACCOUNT_NAME || '')}`;

    return {
        order, qrUrl,
        bankInfo: {
            bankId: process.env.BANK_ID,
            account: process.env.BANK_ACCOUNT,
            accountName: process.env.BANK_ACCOUNT_NAME,
            amount: planInfo.price,
            description: order.orderCode
        }
    };
}

function vnpaySign(params) {
    const sorted = {};
    Object.keys(params).sort().forEach(k => { sorted[k] = params[k]; });
    const signData = querystring.stringify(sorted, { encode: false });
    const signed = crypto.createHmac('sha512', process.env.VNPAY_HASH_SECRET)
        .update(Buffer.from(signData, 'utf-8')).digest('hex');
    return { sorted, signed };
}

async function createVNPayOrder({ plan, chatId, ipAddr }) {
    const planInfo = getPaidPlan(plan);
    if (!process.env.VNPAY_TMN_CODE || !process.env.VNPAY_HASH_SECRET) throw new HttpError(503, 'VNPay chưa được cấu hình');

    const order = await Order.create({
        orderCode: genOrderCode(), chatId: chatId || null,
        plan, durationHours: planInfo.durationHours,
        price: planInfo.price, paymentMethod: 'vnpay', status: 'pending'
    });

    // VNPay yêu cầu giờ Việt Nam (UTC+7), server Render chạy UTC nên phải đổi
    const vn = new Date(Date.now() + 7 * 3600 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const createDate = `${vn.getUTCFullYear()}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}${pad(vn.getUTCSeconds())}`;

    const { sorted, signed } = vnpaySign({
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: process.env.VNPAY_TMN_CODE,
        vnp_Locale: 'vn',
        vnp_CurrCode: 'VND',
        vnp_TxnRef: order.orderCode,
        vnp_OrderInfo: `Thanh toan ${order.orderCode}`,
        vnp_OrderType: 'other',
        vnp_Amount: planInfo.price * 100,
        vnp_ReturnUrl: `${publicUrl()}/api/payment/vnpay/return`,
        vnp_IpAddr: String(ipAddr || '127.0.0.1').split(',')[0].trim(),
        vnp_CreateDate: createDate
    });
    sorted.vnp_SecureHash = signed;

    return { order, payUrl: process.env.VNPAY_URL + '?' + querystring.stringify(sorted, { encode: false }) };
}

async function createMoMoOrder({ plan, chatId }) {
    const planInfo = getPaidPlan(plan);
    if (!process.env.MOMO_PARTNER_CODE || !process.env.MOMO_SECRET_KEY) throw new HttpError(503, 'MoMo chưa được cấu hình');

    const order = await Order.create({
        orderCode: genOrderCode(), chatId: chatId || null,
        plan, durationHours: planInfo.durationHours,
        price: planInfo.price, paymentMethod: 'momo', status: 'pending'
    });

    const requestId = order.orderCode + '_' + Date.now();
    const orderInfo = `Thanh toan ${order.orderCode}`;
    const redirectUrl = `${publicUrl()}/api/payment/momo/return`;
    const ipnUrl = `${publicUrl()}/api/payment/momo/notify`;
    const requestType = 'captureWallet';
    const extraData = '';

    const rawSig =
        `accessKey=${process.env.MOMO_ACCESS_KEY}` +
        `&amount=${planInfo.price}` +
        `&extraData=${extraData}` +
        `&ipnUrl=${ipnUrl}` +
        `&orderId=${order.orderCode}` +
        `&orderInfo=${orderInfo}` +
        `&partnerCode=${process.env.MOMO_PARTNER_CODE}` +
        `&redirectUrl=${redirectUrl}` +
        `&requestId=${requestId}` +
        `&requestType=${requestType}`;

    const signature = crypto.createHmac('sha256', process.env.MOMO_SECRET_KEY).update(rawSig).digest('hex');

    const { data } = await axios.post(process.env.MOMO_ENDPOINT, {
        partnerCode: process.env.MOMO_PARTNER_CODE,
        partnerName: 'PhimHay',
        storeId: 'PhimHayStore',
        requestId, amount: planInfo.price, orderId: order.orderCode,
        orderInfo, redirectUrl, ipnUrl, lang: 'vi',
        extraData, requestType, signature
    }, { timeout: 15000 });

    if (data.resultCode !== 0) {
        order.status = 'cancelled';
        await order.save();
        throw new HttpError(400, data.message || 'MoMo từ chối đơn');
    }
    return { order, payUrl: data.payUrl, qrCodeUrl: data.qrCodeUrl };
}

const httpFail = (res, e) => {
    if (!e.status) console.error('[payment]', e.response?.data || e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Lỗi tạo đơn, thử lại sau' });
};

exports.createVietQR = async (req, res) => {
    try {
        const { plan, chatId, email } = req.body || {};
        res.json({ success: true, ...(await createVietQROrder({ plan, chatId, email })) });
    } catch (e) { httpFail(res, e); }
};

exports.vietqrWebhook = async (req, res) => {
    try {
        // Bắt buộc có secret: nếu để trống thì ai cũng gửi được "giao dịch giả" để nhận key miễn phí
        if (!process.env.VIETQR_WEBHOOK_SECRET) {
            console.error('[vietqr] VIETQR_WEBHOOK_SECRET chưa đặt -> từ chối webhook');
            return res.status(503).json({ error: 'Webhook chưa được cấu hình' });
        }
        const authHeader = String(req.headers['authorization'] || '');
        const expected = `Apikey ${process.env.VIETQR_WEBHOOK_SECRET}`;
        const ok = authHeader.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
        if (!ok) return res.status(401).json({ error: 'Unauthorized' });

        const transactions = Array.isArray(req.body.data) ? req.body.data : [req.body];

        for (const tx of transactions) {
            const description = tx.description || tx.content || '';
            const amount = tx.amount || tx.transferAmount;
            const transactionId = tx.tid || tx.id || tx.referenceCode;

            const match = String(description).match(/DH[A-Z0-9]+/i);
            if (!match) continue;

            const orderCode = match[0].toUpperCase();
            const order = await Order.findOne({ orderCode });
            if (!order || order.status === 'delivered') continue;
            if (Number(amount) < order.price) continue;

            order.status = 'paid';
            order.paidAt = new Date();
            order.paymentRef = transactionId;
            order.paymentData = tx;
            await order.save();
            await deliverKey(order);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('VietQR webhook:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.getQRImage = async (req, res) => {
    try {
        const order = await Order.findOne({ orderCode: req.params.orderCode });
        if (!order) return res.status(404).send('Not found');
        const qrUrl =
            `https://img.vietqr.io/image/${process.env.BANK_ID}-${process.env.BANK_ACCOUNT}-compact2.png` +
            `?amount=${order.price}&addInfo=${encodeURIComponent(order.orderCode)}` +
            `&accountName=${encodeURIComponent(process.env.BANK_ACCOUNT_NAME || '')}`;
        const buffer = await QRCode.toBuffer(qrUrl);
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (e) { res.status(500).send(e.message); }
};

exports.createVNPay = async (req, res) => {
    try {
        const ipAddr = req.ip || req.socket.remoteAddress;
        res.json({ success: true, ...(await createVNPayOrder({ plan: req.body?.plan, chatId: req.body?.chatId, ipAddr })) });
    } catch (e) { httpFail(res, e); }
};

exports.vnpayReturn = async (req, res) => {
    try {
        const params = { ...req.query };
        const secureHash = params['vnp_SecureHash'];
        delete params['vnp_SecureHash'];
        delete params['vnp_SecureHashType'];
        const { signed } = vnpaySign(params);

        if (secureHash !== signed) {
            return res.redirect('/payment-result.html?status=invalid');
        }

        const order = await Order.findOne({ orderCode: params['vnp_TxnRef'] });
        if (!order) return res.redirect('/payment-result.html?status=notfound');
        if (Number(params['vnp_Amount']) !== order.price * 100) return res.redirect('/payment-result.html?status=invalid');

        if (params['vnp_ResponseCode'] === '00') {
            if (order.status !== 'delivered') {
                order.status = 'paid';
                order.paidAt = new Date();
                order.paymentRef = params['vnp_TransactionNo'];
                order.paymentData = params;
                await order.save();
                await deliverKey(order);
            }
            return res.redirect(`/payment-result.html?status=success&order=${order.orderCode}&key=${encodeURIComponent(order.keyValue || '')}`);
        } else {
            order.status = 'cancelled';
            await order.save();
            return res.redirect(`/payment-result.html?status=failed&order=${order.orderCode}`);
        }
    } catch (e) {
        res.redirect('/payment-result.html?status=error');
    }
};

exports.vnpayIPN = async (req, res) => {
    try {
        const params = { ...req.query };
        const secureHash = params['vnp_SecureHash'];
        delete params['vnp_SecureHash'];
        delete params['vnp_SecureHashType'];
        const { signed } = vnpaySign(params);

        if (secureHash !== signed) return res.json({ RspCode: '97', Message: 'Invalid' });

        const order = await Order.findOne({ orderCode: params['vnp_TxnRef'] });
        if (!order) return res.json({ RspCode: '01', Message: 'Not found' });
        if (order.status === 'delivered') return res.json({ RspCode: '02', Message: 'Confirmed' });
        if (Number(params['vnp_Amount']) !== order.price * 100) return res.json({ RspCode: '04', Message: 'Invalid amount' });

        if (params['vnp_ResponseCode'] === '00') {
            order.status = 'paid';
            order.paidAt = new Date();
            order.paymentRef = params['vnp_TransactionNo'];
            order.paymentData = params;
            await order.save();
            await deliverKey(order);
        }
        res.json({ RspCode: '00', Message: 'Success' });
    } catch (e) { res.json({ RspCode: '99', Message: e.message }); }
};

exports.createMoMo = async (req, res) => {
    try {
        res.json({ success: true, ...(await createMoMoOrder({ plan: req.body?.plan, chatId: req.body?.chatId })) });
    } catch (e) { httpFail(res, e); }
};

/**
 * Xác thực chữ ký MoMo (return + IPN dùng chung danh sách trường theo tài liệu MoMo v2).
 * Bản cũ KHÔNG kiểm tra chữ ký -> ai gọi /momo/notify hay mở link /momo/return?resultCode=0
 * cũng nhận được key miễn phí.
 */
function momoVerify(p) {
    if (!p || !p.signature || !process.env.MOMO_SECRET_KEY) return false;
    const fields = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType',
        'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
    const raw = fields.map(k => `${k}=${k === 'accessKey' ? process.env.MOMO_ACCESS_KEY : (p[k] ?? '')}`).join('&');
    const expected = crypto.createHmac('sha256', process.env.MOMO_SECRET_KEY).update(raw).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(String(p.signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function momoSettle(p) {
    const order = await Order.findOne({ orderCode: p.orderId });
    if (!order) return { order: null, status: 'notfound' };
    if (Number(p.amount) !== order.price) return { order, status: 'invalid' };
    if (String(p.resultCode) !== '0') {
        if (order.status === 'pending') { order.status = 'cancelled'; await order.save(); }
        return { order, status: 'failed' };
    }
    if (order.status !== 'delivered') {
        order.status = 'paid';
        order.paidAt = new Date();
        order.paymentRef = String(p.transId || '');
        order.paymentData = p;
        await order.save();
        await deliverKey(order);
    }
    return { order, status: 'success' };
}

exports.momoReturn = async (req, res) => {
    try {
        if (!momoVerify(req.query)) return res.redirect('/payment-result.html?status=invalid');
        const { order, status } = await momoSettle(req.query);
        if (status === 'success') {
            return res.redirect(`/payment-result.html?status=success&order=${order.orderCode}&key=${encodeURIComponent(order.keyValue || '')}`);
        }
        res.redirect(`/payment-result.html?status=${status}${order ? `&order=${order.orderCode}` : ''}`);
    } catch (e) {
        console.error('[momo return]', e);
        res.redirect('/payment-result.html?status=error');
    }
};

exports.momoNotify = async (req, res) => {
    try {
        if (!momoVerify(req.body)) return res.status(400).json({ message: 'Invalid signature' });
        await momoSettle(req.body);
        res.status(204).end();      // MoMo yêu cầu 204 No Content
    } catch (e) {
        console.error('[momo notify]', e);
        res.status(500).json({ message: 'error' });
    }
};

exports.getOrderStatus = async (req, res) => {
    const order = await Order.findOne({ orderCode: req.params.orderCode });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json({
        orderCode: order.orderCode,
        status: order.status,
        plan: order.plan,
        price: order.price,
        keyValue: order.status === 'delivered' ? order.keyValue : null,
        paidAt: order.paidAt,
        deliveredAt: order.deliveredAt
    });
};

exports.deliverKey = deliverKey;
exports.createVietQROrder = createVietQROrder;
exports.createVNPayOrder = createVNPayOrder;
exports.createMoMoOrder = createMoMoOrder;
exports.formatPrice = formatPrice;
