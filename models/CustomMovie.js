const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    poster: String,
    backdrop: String,
    year: Number,
    genres: [String],
    country: String,
    quality: { type: String, default: 'HD' },
    language: { type: String, default: 'Vietsub' },
    videoType: { type: String, enum: ['m3u8', 'mp4', 'iframe'], default: 'iframe' },
    // Không còn bắt buộc: phim bộ chỉ cần link ở từng tập
    videoUrl: { type: String, default: '' },
    episodes: [{
        name: String,
        slug: String,
        embed: String,
        m3u8: String,
        mp4: String
    }],
    isSeries: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    featured: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('CustomMovie', schema);
