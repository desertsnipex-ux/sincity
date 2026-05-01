require('dotenv').config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const DiscordStrategy = require("passport-discord").Strategy;
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const User = require("./models/User");
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(ROOT, "data");
const CONTENT_FILE = path.join(DATA_DIR, "content.json");
const APPLICATIONS_FILE = path.join(DATA_DIR, "applications.json");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime.json");

const PORT = process.env.PORT || 4173;

// Discord Bot initialization
const discordClient = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

if (process.env.DISCORD_BOT_TOKEN) {
  discordClient.login(process.env.DISCORD_BOT_TOKEN)
    .then(() => console.log("SUCCESS: Discord Bot connected and Online"))
    .catch(err => console.error("ERROR: Discord Bot login failed:", err.message));
}

discordClient.on('ready', () => {
  console.log(`Logged in as ${discordClient.user.tag}!`);
});

console.log("--- SinCity Server Initialization ---");
console.log(`Root Directory: ${ROOT}`);

// MongoDB Connection
if (!process.env.MONGODB_URI) {
  console.error("CRITICAL: MONGODB_URI is not defined in .env file");
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("SUCCESS: Connected to MongoDB Atlas"))
  .catch(err => {
    console.error("ERROR: MongoDB connection failed:", err.message);
    process.exit(1);
  });

// Email Transporter - DISABLED FOR SIMPLIFIED LOGIN
/*
let transporter;

// Use SendGrid if configured, otherwise fallback to Gmail
if (process.env.SENDGRID_API_KEY) {
  transporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
      api_key: process.env.SENDGRID_API_KEY
    }
  });
  console.log('Using SendGrid for email service');
} else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  console.log('Using Gmail for email service');
} else {
  console.log('No email service configured - using Ethereal for testing');
  // Ethereal for testing (emails won't actually send)
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: 'ethereal_user@ethereal.email',
      pass: 'ethereal_pass'
    }
  });
}
*/
console.log('Email verification system disabled - simplified login enabled');

// Multer Configuration for Avatar Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(ROOT, 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const userId = req.user ? req.user._id : 'anonymous';
    cb(null, 'avatar-' + userId + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) return cb(null, true);
    cb(new Error("Only images (jpeg, jpg, png, webp) are allowed"));
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "sincity-ultra-secret-key-2026",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Configuration
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { const user = await User.findById(id); done(null, user); } 
  catch (err) { done(err, null); }
});

// Local Strategy
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await User.findOne({ email });
    if (!user || !user.password) return done(null, false, { message: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return done(null, false, { message: 'Invalid credentials' });
    
    // Bypass email verification check for simplified login
    if (!user.emailVerified) {
      user.emailVerified = true;
      await user.save();
    }
    
    return done(null, user);
  } catch (err) { return done(err); }
}));

// Google Strategy
if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      if (req.user) {
        req.user.googleId = profile.id;
        await req.user.save();
        return done(null, req.user);
      }
      let user = await User.findOne({ googleId: profile.id });
      if (!user) {
        const email = profile.emails[0].value;
        user = await User.findOne({ email });
        if (user) { user.googleId = profile.id; await user.save(); }
        else { user = await User.create({ googleId: profile.id, email, displayName: profile.displayName, avatar: profile.photos[0].value }); }
      }
      return done(null, user);
    } catch (err) { return done(err); }
  }));
}

// Discord Strategy
if (process.env.DISCORD_CLIENT_ID) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email'],
    passReqToCallback: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      if (req.user) {
        req.user.discordId = profile.id;
        req.user.discordUsername = profile.username;
        await req.user.save();
        return done(null, req.user);
      }
      let user = await User.findOne({ discordId: profile.id });
      if (!user) {
        user = await User.findOne({ email: profile.email });
        if (user) { 
          user.discordId = profile.id; 
          user.discordUsername = profile.username;
          await user.save(); 
        }
        else { 
          user = await User.create({ 
            discordId: profile.id, 
            discordUsername: profile.username,
            email: profile.email, 
            displayName: profile.username, 
            avatar: `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` 
          }); 
        }
      } else {
        // Update username if it changed
        if (user.discordUsername !== profile.username) {
          user.discordUsername = profile.username;
          await user.save();
        }
      }
      return done(null, user);
    } catch (err) { return done(err); }
  }));
}

// --- AUTH ROUTES ---
app.post("/auth/signup", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: "Email already registered" });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    user = await User.create({ 
      email, 
      password: hashedPassword, 
      displayName,
      emailVerified: true // Auto-verify for now
    });
    
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: "Login failed" });
      res.json({ ok: true, message: "Registration successful!" });
    });
  } catch (err) { 
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// Email Verification Route - DISABLED FOR SIMPLIFIED LOGIN
/*
app.get("/auth/verify-email/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({ 
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).send(`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; padding: 40px; background: #030805; color: white; text-align: center; border-radius: 8px; border: 1px solid #ff5f5f;">
          <h1 style="color: #ff5f5f;">Verification Failed</h1>
          <p>The verification link is invalid or has expired.</p>
          <p style="margin-top: 30px;">
            <a href="/login" style="background: #ff5f5f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Back to Login</a>
          </p>
        </div>
      `);
    }
    
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    
    // Auto-login or redirect to login with success
    res.send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; padding: 40px; background: #030805; color: white; text-align: center; border-radius: 8px; border: 1px solid #8eff69;">
        <h1 style="color: #8eff69;">Identity Verified</h1>
        <p>Your digital record has been successfully activated.</p>
        <div style="margin-top: 30px;">
          <a href="/login?verified=true" style="background: #8eff69; color: #030805; padding: 12px 30px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block; text-transform: uppercase;">Continue to Mainframe</a>
        </div>
      </div>
    `);
  } catch (err) {
    res.status(500).send("Verification error");
  }
});

// Resend Verification Email
app.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(400).json({ error: "No citizen record found with that address." });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({ error: "Record is already active." });
    }
    
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    await user.save();
    
    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email/${verificationToken}`;
    const siteName = "SinCity";
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_USER || 'noreply@sincity.com';

    const mailOptions = {
      from: `"${siteName}" <${fromEmail}>`,
      to: email,
      subject: `${siteName} - New Verification Link`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #030805; color: white; border: 1px solid #222;">
          <div style="text-align: center; margin-bottom: 30px; border-bottom: 1px solid #8eff69; padding-bottom: 10px;">
            <h1 style="color: #8eff69; margin: 0;">${siteName}</h1>
            <p style="color: #8e9db9; margin: 5px 0;">RESEND TRANSMISSION</p>
          </div>
          <div style="padding: 10px;">
            <p style="color: #ccc; line-height: 1.6;">As requested, here is a new verification link to activate your citizen record.</p>
            <div style="text-align: center; margin: 40px 0;">
              <a href="${verificationUrl}" style="background: #8eff69; color: #030805; padding: 14px 40px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block; text-transform: uppercase; letter-spacing: 1px;">Verify Record</a>
            </div>
            <p style="font-size: 12px; color: #8e9db9; margin-top: 30px; border-top: 1px solid #222; padding-top: 10px;">This link will expire in 24 hours.</p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    res.json({ ok: true, message: "A new verification link has been sent to your address." });
  } catch (err) {
    console.error('Resend error:', err);
    res.status(500).json({ error: "Failed to send email. Check mainframe configuration." });
  }
});
*/

app.post("/auth/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: info.message });
    
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: "Login failed" });
      res.json({ ok: true });
    });
  })(req, res, next);
});

// Forgot Password - DISABLED FOR SIMPLIFIED LOGIN
/*
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "No account with that email." });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const mailOptions = {
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'SinCity Central Mainframe - Password Reset',
      text: `You are receiving this because you (or someone else) have requested the reset of the password for your citizen record.\n\n` +
        `Please click on the following link, or paste this into your browser to complete the process:\n\n` +
        `http://${req.headers.host}/reset-password.html?token=${token}\n\n` +
        `If you did not request this, please ignore this email and your password will remain unchanged.\n`
    };

    await transporter.sendMail(mailOptions);
    res.json({ ok: true, message: "Email sent." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
*/

// Reset Password - DISABLED FOR SIMPLIFIED LOGIN
/*
app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    const user = await User.findOne({ 
      resetPasswordToken: token, 
      resetPasswordExpires: { $gt: Date.now() } 
    });

    if (!user) return res.status(400).json({ error: "Password reset token is invalid or has expired." });

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ ok: true, message: "Password updated." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
*/

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/login" }), (req, res) => res.redirect("/profile"));

app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback", (req, res, next) => {
  passport.authenticate("discord", { failureRedirect: "/login" })(req, res, next);
}, (req, res) => res.redirect("/profile"));

app.get("/auth/discord/link", (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  passport.authorize("discord")(req, res, next);
});

app.get("/auth/logout", (req, res) => {
  req.logout(() => res.redirect("/"));
});

// --- PAGE ROUTES ---
app.get("/login", (req, res) => res.sendFile(path.join(ROOT, "login.html")));
app.get("/profile", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.sendFile(path.join(ROOT, "profile.html"));
});
app.get("/forgot-password", (req, res) => res.sendFile(path.join(ROOT, "forgot-password.html")));
app.get("/reset-password", (req, res) => res.sendFile(path.join(ROOT, "reset-password.html")));
app.get("/apply.html", (req, res) => res.sendFile(path.join(ROOT, "apply.html")));

// --- API ROUTES ---
app.get("/api/me", (req, res) => res.json({ authenticated: req.isAuthenticated(), user: req.user || null }));

// Staff authorization helper
function isStaff(req) {
  return req.isAuthenticated() && (req.user.role === 'admin' || req.user.role === 'mod');
}

// Upload Avatar
app.post("/api/me/avatar", (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  next();
}, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    
    const user = await User.findById(req.user._id);
    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(ROOT, user.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    
    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await user.save();
    
    res.json({ ok: true, avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Profile
app.put("/api/me", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    const { displayName, bio } = req.body;
    const user = await User.findById(req.user._id);
    if (displayName) user.displayName = displayName;
    if (bio !== undefined) user.bio = bio;
    await user.save();
    
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Whitelist Draft Management
app.get("/api/me/draft", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    res.json({ ok: true, draft: req.user.whitelistDraft || null });
  } catch (err) {
    console.error('Error loading draft:', err);
    res.status(500).json({ error: "Failed to load draft" });
  }
});

app.get("/api/me/applications", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    const userApps = applications.filter(app => app.userId === req.user._id.toString());
    res.json({ ok: true, applications: userApps });
  } catch (err) {
    console.error('Error loading user applications:', err);
    res.status(500).json({ error: "Failed to load your applications" });
  }
});

app.put("/api/me/draft", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    const user = await User.findById(req.user._id);
    user.whitelistDraft = req.body;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/me/draft", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    const user = await User.findById(req.user._id);
    user.whitelistDraft = null;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Account
app.delete("/api/me", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    const user = await User.findById(req.user._id);
    
    // Delete user's avatar file if it exists
    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const avatarPath = path.join(__dirname, user.avatar);
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }
    
    // Delete user from database
    await User.findByIdAndDelete(req.user._id);
    
    // Logout user
    req.logout(() => {
      res.json({ ok: true, message: "Account deleted successfully" });
    });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// Staff Review Dashboard Routes
app.get("/api/applications", async (req, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff access required" });
  }

  try {
    const applications = readJson(APPLICATIONS_FILE);
    res.json({ ok: true, applications });
  } catch (err) {
    console.error('Error loading applications:', err);
    res.status(500).json({ error: "Failed to load applications" });
  }
});

app.post("/api/applications/:id/approve", async (req, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff access required" });
  }

  try {
    const { id } = req.params;
    const applications = readJson(APPLICATIONS_FILE);
    const application = applications.find(app => app.id === id);

    if (!application) {
      console.log('Application not found for ID:', id);
      console.log('Available IDs:', applications.map(app => app.id));
      return res.status(404).json({ error: "Application not found" });
    }

    application.status = 'approved';
    application.reviewedAt = new Date().toISOString();
    application.reviewedBy = req.user.displayName;

    writeJson(APPLICATIONS_FILE, applications);

    // Sync Discord Role if account is linked
    try {
      if (application.userId) {
        const applicant = await User.findById(application.userId);
        if (applicant && applicant.discordId) {
          await assignDiscordRole(applicant.discordId);
        }
      }
    } catch (syncErr) {
      console.error('Discord Role Sync failed during approval:', syncErr);
    }

    // Send Discord notification
    await sendDiscordNotification(application, 'approved', req);

    res.json({ ok: true, message: "Application approved successfully" });
  } catch (err) {
    console.error('Error approving application:', err);
    res.status(500).json({ error: "Failed to approve application" });
  }
});

app.post("/api/applications/:id/deny", async (req, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff access required" });
  }

  try {
    const { id } = req.params;
    const applications = readJson(APPLICATIONS_FILE);
    const application = applications.find(app => app.id === id);

    if (!application) {
      console.log('Application not found for ID:', id);
      console.log('Available IDs:', applications.map(app => app.id));
      return res.status(404).json({ error: "Application not found" });
    }

    application.status = 'denied';
    application.reviewedAt = new Date().toISOString();
    application.reviewedBy = req.user.displayName;

    writeJson(APPLICATIONS_FILE, applications);

    // Send Discord notification
    await sendDiscordNotification(application, 'denied', req);

    res.json({ ok: true, message: "Application denied successfully" });
  } catch (err) {
    console.error('Error denying application:', err);
    res.status(500).json({ error: "Failed to deny application" });
  }
});

// Admin Panel Routes
app.get("/api/admin/users", async (req, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff access required" });
  }

  try {
    const users = await User.find({}).select('displayName email role createdAt');
    res.json({ ok: true, users });
  } catch (err) {
    console.error('Error loading users:', err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

app.post("/api/admin/users/:id/role", async (req, res) => {
  if (!req.isAuthenticated() || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const { id } = req.params;
    const { role } = req.body;
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    user.role = role;
    await user.save();
    
    res.json({ ok: true, message: `User role updated to ${role}` });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ error: "Failed to update user role" });
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  if (!req.isAuthenticated() || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    await User.findByIdAndDelete(id);
    
    res.json({ ok: true, message: "User deleted successfully" });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Admin System Settings Routes
app.get("/api/admin/settings", async (req, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff access required" });
  }

  try {
    const settings = {
      siteName: "SinCity",
      maintenance: false,
      registrationOpen: true,
      discordBotStatus: discordClient.isReady() ? "Online" : "Offline",
      discordWebhook: process.env.SINCITY_DISCORD_WEBHOOK ? "Configured" : "Not configured",
      emailService: process.env.SENDGRID_API_KEY || process.env.EMAIL_USER ? "Configured" : "Not configured"
    };
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('Error loading settings:', err);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

app.post("/api/admin/settings", async (req, res) => {
  if (!req.isAuthenticated() || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const { siteName, maintenance, registrationOpen } = req.body;
    
    // Update content.json with new settings
    content.site.name = siteName || content.site.name;
    
    writeJson(CONTENT_FILE, content);
    
    res.json({ ok: true, message: "Settings updated successfully" });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// Admin Analytics Routes
app.get("/api/admin/analytics", async (req, res) => {
  if (!req.isAuthenticated() || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const users = await User.find({});
    const applications = readJson(APPLICATIONS_FILE);
    
    const analytics = {
      totalUsers: users.length,
      adminUsers: users.filter(u => u.role === 'admin').length,
      regularUsers: users.filter(u => u.role === 'user').length,
      totalApplications: applications.length,
      pendingApplications: applications.filter(a => a.status === 'pending').length,
      approvedApplications: applications.filter(a => a.status === 'approved').length,
      deniedApplications: applications.filter(a => a.status === 'denied').length,
      recentUsers: users.slice(-5).map(u => ({
        displayName: u.displayName,
        email: u.email,
        createdAt: u.createdAt
      })),
      recentApplications: applications.slice(-5).map(a => ({
        displayName: a.displayName,
        status: a.status,
        createdAt: a.createdAt
      })),
      userGrowth: {
        last7Days: users.filter(u => new Date(u.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length,
        last30Days: users.filter(u => new Date(u.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length
      }
    };
    
    res.json({ ok: true, analytics });
  } catch (err) {
    console.error('Error loading analytics:', err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// Admin Logs Routes
app.get("/api/admin/logs", async (req, res) => {
  if (!req.isAuthenticated() || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    // Generate mock logs since we don't have a real logging system
    const logs = [
      { timestamp: new Date().toISOString(), level: 'info', message: 'Server started successfully', user: 'System' },
      { timestamp: new Date(Date.now() - 3600000).toISOString(), level: 'info', message: 'New user registration', user: 'user@example.com' },
      { timestamp: new Date(Date.now() - 7200000).toISOString(), level: 'warning', message: 'Failed login attempt', user: 'unknown' },
      { timestamp: new Date(Date.now() - 10800000).toISOString(), level: 'info', message: 'Application submitted', user: 'applicant@example.com' },
      { timestamp: new Date(Date.now() - 14400000).toISOString(), level: 'error', message: 'Discord webhook failed', user: 'System' }
    ];
    
    res.json({ ok: true, logs });
  } catch (err) {
    console.error('Error loading logs:', err);
    res.status(500).json({ error: "Failed to load logs" });
  }
});

// Discord Role Sync helper
async function assignDiscordRole(discordId) {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID || !process.env.DISCORD_WHITELIST_ROLE_ID) {
    console.log('Discord Role Sync not fully configured - skipping role assignment');
    return;
  }

  try {
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      console.error('ERROR: Could not find Discord Guild. Check DISCORD_GUILD_ID');
      return;
    }

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      console.warn(`WARNING: User with ID ${discordId} is not in the Discord server.`);
      return;
    }

    const role = await guild.roles.fetch(process.env.DISCORD_WHITELIST_ROLE_ID);
    if (!role) {
      console.error('ERROR: Could not find Discord Role. Check DISCORD_WHITELIST_ROLE_ID');
      return;
    }

    // Check if member already has the role
    if (member.roles.cache.has(role.id)) {
      console.log(`User ${member.user.tag} already has the whitelisted role.`);
      return;
    }

    await member.roles.add(role, 'SinCity Whitelist Approved');
    console.log(`SUCCESS: Assigned Whitelisted role to ${member.user.tag}`);
    
  } catch (err) {
    if (err.code === 50013) {
      console.error('CRITICAL: Discord Bot lacks "Manage Roles" permission or its role is below the target role.');
    } else {
      console.error('Error in Discord Role Sync:', err.message);
    }
  }
}

// Discord notification helper
async function sendDiscordNotification(application, action, req) {
  const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (!logChannelId) {
    console.log('DISCORD_LOG_CHANNEL_ID not set - skipping channel notification');
  }

  const color = action === 'approved' ? 0x28a745 : 0xdc3545;
  const emoji = action === 'approved' ? '✅' : '❌';

  const embed = {
    title: `${emoji} Whitelist Application ${action.charAt(0).toUpperCase() + action.slice(1)}`,
    description: `Citizen **${application.displayName}** has been **${action}**.`,
    color: color,
    thumbnail: {
      // Replace with your hosted logo URL (e.g. from Imgur or your web server)
      url: 'https://media.tenor.com/1MCucyOSJ54AAAAi/kicau-maniaa.gif' 
    },
    author: {
      name: application.displayName,
      icon_url: application.avatar ? `${req.protocol}://${req.get('host')}${application.avatar}` : undefined
    },
    fields: [
      { name: 'Discord Handle', value: application.discord, inline: true },
      { name: 'Status', value: action.toUpperCase(), inline: true }
    ],
    footer: { text: `SinCity Mainframe` },
    timestamp: new Date().toISOString()
  };

  try {
    // 1. Send to Log Channel
    if (logChannelId) {
      const channel = await discordClient.channels.fetch(logChannelId).catch(() => null);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    }

    // 2. Try to DM the user (The "Pro" touch)
    if (application.userId) {
      const userDoc = await User.findById(application.userId);
      if (userDoc && userDoc.discordId) {
        const member = await discordClient.users.fetch(userDoc.discordId).catch(() => null);
        if (member) {
          await member.send(`📡 **TRANSMISSION FROM SINCITY:** Your whitelist application has been **${action.toUpperCase()}**. ${action === 'approved' ? 'Welcome to the city.' : 'You may re-apply in 24 hours.'}`).catch(() => console.log("Could not DM user, they might have DMs off."));
        }
      }
    }
    
    console.log(`Notification sent for ${application.displayName}`);
  } catch (err) {
    console.error('Error sending Discord notification:', err.message);
  }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

// Initialize data files
let content, applications, runtime;
try {
  content = readJson(CONTENT_FILE);
  applications = readJson(APPLICATIONS_FILE);
  runtime = readJson(RUNTIME_FILE);
} catch (err) {
  console.error('Error loading data files:', err);
  process.exit(1);
}

app.get("/api/bootstrap", (req, res) => {
  try {
    res.json({ content, runtime: { ...runtime, applicationCount: applications.length } });
  } catch (err) { res.status(500).json({ error: "Data sync failed" }); }
});

app.post("/api/applications", (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Authorized session required" });
  try {
    const newApp = { id: `app-${Date.now()}`, ...req.body, userId: req.user._id, status: "pending", createdAt: new Date().toISOString() };
    applications.unshift(newApp);
    writeJson(APPLICATIONS_FILE, applications);
    res.status(201).json({ ok: true, application: newApp });
  } catch (err) { res.status(500).json({ error: "Failed to save application" }); }
});

// Static assets
app.use('/uploads', express.static(path.join(ROOT, 'uploads')));
app.use(express.static(ROOT));

app.listen(PORT, () => console.log(`--- SinCity Mainframe Active: http://localhost:${PORT} ---`));
