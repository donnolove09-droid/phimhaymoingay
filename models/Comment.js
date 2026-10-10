const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    movieSlug: { type: String, required: true, index: true },
    movieSource: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: String,
    content: { type: String, required: true, maxlength: 1000 },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    isEdited: { type: Boolean, default: false }
}, { timestamps: true });

commentSchema.index({ movieSlug: 1, movieSource: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
