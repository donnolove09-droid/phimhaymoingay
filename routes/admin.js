const express = require('express');
const ctrl = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.post('/login', ctrl.login);
router.get('/settings', requireAdmin, ctrl.getSettings);
router.put('/settings/access-key', requireAdmin, ctrl.updateAccessKey);
router.put('/settings/password', requireAdmin, ctrl.changePassword);
router.get('/keys/stats', requireAdmin, ctrl.getKeyStats);
router.get('/keys/used', requireAdmin, ctrl.getUsedKeys);
router.post('/keys/reset', requireAdmin, ctrl.resetKey);
router.post('/keys/revoke', requireAdmin, ctrl.revokeKey);
router.post('/keys/import', requireAdmin, ctrl.importKeys);
router.get('/orders', requireAdmin, ctrl.getOrders);
router.post('/mail/test', requireAdmin, ctrl.mailTest);
router.get('/telegram/status', requireAdmin, ctrl.telegramStatus);
router.post('/telegram/set-webhook', requireAdmin, ctrl.telegramSetWebhook);
router.post('/orders/:orderCode/confirm', requireAdmin, ctrl.confirmOrder);

module.exports = router;
