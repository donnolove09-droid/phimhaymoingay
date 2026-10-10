const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: mongoose.Schema.Types.Mixed,
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Setting', schema);
