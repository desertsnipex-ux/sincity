const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, unique: true, sparse: true },
  discordId: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  displayName: String,
  avatar: String,
  bio: { type: String, default: "" },
  role: { type: String, default: 'user' },
  resetPasswordToken: String,
  resetPasswordExpires: Date
}, { 
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
