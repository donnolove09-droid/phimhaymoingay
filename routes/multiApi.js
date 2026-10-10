const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/multiApiController');
const { requireAdmin } = require('../middleware/auth');

router.get('/sources', ctrl.listSources);
router.get('/sources/health', requireAdmin, ctrl.health);
router.get('/aggregate', ctrl.aggregate);
router.get('/search', ctrl.searchAll);

// Dạng chung: /api/multi/<nguồn>/new | /search | /movie/:slug
// (tương thích URL cũ: nguonc, kkphim, ophim)
router.get('/:source/new', ctrl.newBySource);
router.get('/:source/search', ctrl.searchBySource);
router.get('/:source/movie/:slug', ctrl.detailBySource);

module.exports = router;
