const express = require('express');
const Movie = require('../models/Movie');
const router = express.Router();

router.get('/favorites', async (req, res) => {
    const list = await Movie.find().sort({ createdAt: -1 });
    res.json(list);
});

router.post('/favorites', async (req, res) => {
    const doc = await Movie.findOneAndUpdate(
        { tmdbId: req.body.tmdbId },
        req.body,
        { upsert: true, new: true }
    );
    res.json(doc);
});

router.delete('/favorites/:tmdbId', async (req, res) => {
    await Movie.findOneAndDelete({ tmdbId: req.params.tmdbId });
    res.json({ success: true });
});

module.exports = router;
