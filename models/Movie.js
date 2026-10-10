const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    tmdbId: { type: Number, required: true, unique: true },
    title: String,
    overview: String,
    posterPath: String,
    backdropPath: String,
    releaseDate: String,
    voteAverage: Number,
    genres: [String]
}, { timestamps: true });

module.exports = mongoose.model('Movie', schema);
