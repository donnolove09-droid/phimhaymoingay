require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const AccessKey = require('../models/AccessKey');

const KEY_FILE = path.join(__dirname, '..', 'data', 'keys.txt');

(async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        const content = fs.readFileSync(KEY_FILE, 'utf-8');
        const keys = [...new Set(content.split('\n')
            .map(l => l.trim().toUpperCase())
            .filter(l => l.length > 0))];

        console.log(`Found ${keys.length} keys`);

        const ops = keys.map(k => ({
            updateOne: {
                filter: { key: k },
                update: { $setOnInsert: { key: k, isUsed: false } },
                upsert: true
            }
        }));

        const result = await AccessKey.bulkWrite(ops);
        console.log(`Inserted: ${result.upsertedCount}`);

        const total = await AccessKey.countDocuments();
        const unused = await AccessKey.countDocuments({ isUsed: false });
        console.log(`Total: ${total}, Unused: ${unused}`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
