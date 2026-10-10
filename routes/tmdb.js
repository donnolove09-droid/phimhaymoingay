const express = require('express');
const ctrl = require('../controllers/tmdbController');
const router = express.Router();

router.get('/popular', ctrl.getPopular);
router.get('/top-rated', ctrl.getTopRated);
router.get('/now-playing', ctrl.getNowPlaying);
router.get('/search', ctrl.searchMovies);
router.get('/movie/:id', ctrl.getMovieDetail);

module.exports = router;
