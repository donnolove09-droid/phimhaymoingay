const express = require('express');
const ctrl = require('../controllers/paymentController');
const router = express.Router();

router.post('/vietqr/create', ctrl.createVietQR);
router.post('/vietqr/webhook', ctrl.vietqrWebhook);
router.get('/vietqr/qr/:orderCode', ctrl.getQRImage);

router.post('/vnpay/create', ctrl.createVNPay);
router.get('/vnpay/return', ctrl.vnpayReturn);
router.get('/vnpay/ipn', ctrl.vnpayIPN);

router.post('/momo/create', ctrl.createMoMo);
router.get('/momo/return', ctrl.momoReturn);
router.post('/momo/notify', ctrl.momoNotify);

router.get('/status/:orderCode', ctrl.getOrderStatus);

module.exports = router;
