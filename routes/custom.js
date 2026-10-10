const express = require('express');
const ctrl = require('../controllers/customController');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/admin/all', requireAdmin, ctrl.adminList);
router.post('/admin', requireAdmin, ctrl.create);
router.put('/admin/:id', requireAdmin, ctrl.update);
router.delete('/admin/:id', requireAdmin, ctrl.remove);

router.get('/', ctrl.list);
router.get('/search', ctrl.search);
router.get('/:slug', ctrl.detail);

module.exports = router;
