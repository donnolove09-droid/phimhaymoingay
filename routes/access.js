const express = require('express');
const ctrl = require('../controllers/accessController');
const router = express.Router();

router.post('/verify', ctrl.verifyKey);
router.get('/status', ctrl.status);

module.exports = router;
