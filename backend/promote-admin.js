require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const emailToPromote = process.argv[2];

if (!emailToPromote) {
  console.log("Usage: node promote-admin.js <email>");
  process.exit(1);
}

async function promote() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to database...");

    const user = await User.findOneAndUpdate(
      { email: emailToPromote },
      { role: 'admin' },
      { new: true }
    );

    if (user) {
      console.log(`\n✅ SUCCESS: User ${user.displayName} (${user.email}) is now an ADMIN.`);
    } else {
      console.log(`\n❌ ERROR: No user found with email: ${emailToPromote}`);
    }
  } catch (err) {
    console.error("Connection failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

promote();
