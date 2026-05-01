const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, unique: true, sparse: true },
  discordId: { type: String, unique: true, sparse: true },
  discordUsername: { type: String },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  displayName: String,
  avatar: String,
  bio: { type: String, default: "" },
  role: { type: String, default: 'user' },
  whitelistDraft: { type: Object, default: null },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  emailVerified: { type: Boolean, default: true }, // Auto-verified for simplified login
  emailVerificationToken: String,
  emailVerificationExpires: Date
}, { 
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
