const express = require('express');
const ctrl = require('../controllers/ophimController');
const router = express.Router();

router.get('/new', ctrl.getNewMovies);
router.get('/search', ctrl.searchMovies);
router.get('/movie/:slug', ctrl.getMovieDetail);

module.exports = router;
