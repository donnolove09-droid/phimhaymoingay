const express = require('express');
const ctrl = require('../controllers/trialController');
const tokenCtrl = require('../controllers/trialTokenController');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/availability', ctrl.availability);
router.post('/claim', ctrl.claim);
router.get('/stats', requireAdmin, ctrl.stats);

router.get('/token/verify', tokenCtrl.verifyToken);
router.post('/token/claim', tokenCtrl.claimByToken);
router.get('/token/stats', requireAdmin, tokenCtrl.stats);

module.exports = router;
