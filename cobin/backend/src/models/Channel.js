// backend/src/models/Channel.js

const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema(
  {
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server', required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['TEXT', 'VOICE'], default: 'TEXT' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Channel', channelSchema);
