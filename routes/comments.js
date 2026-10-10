const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/commentController');
const { requireUser } = require('../middleware/userAuth');

router.get('/:source/:slug', ctrl.list);
router.post('/', requireUser, ctrl.create);
router.delete('/:id', requireUser, ctrl.remove);
router.post('/:id/like', requireUser, ctrl.like);

module.exports = router;
