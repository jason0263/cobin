// backend/src/models/PasswordResetToken.js

const mongoose = require('mongoose');

const passwordResetTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

module.exports = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
