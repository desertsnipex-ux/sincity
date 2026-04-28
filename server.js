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
const https = require("https");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const multer = require("multer");
const User = require("./models/User");

const app = express();
const ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(ROOT, "data");
const CONTENT_FILE = path.join(DATA_DIR, "content.json");
const APPLICATIONS_FILE = path.join(DATA_DIR, "applications.json");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime.json");

const PORT = process.env.PORT || 4173;

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

// Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Multer Configuration for Avatar Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(ROOT, 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + req.user._id + '-' + uniqueSuffix + path.extname(file.originalname));
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
        await req.user.save();
        return done(null, req.user);
      }
      let user = await User.findOne({ discordId: profile.id });
      if (!user) {
        user = await User.findOne({ email: profile.email });
        if (user) { user.discordId = profile.id; await user.save(); }
        else { user = await User.create({ discordId: profile.id, email: profile.email, displayName: profile.username, avatar: `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` }); }
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
    user = await User.create({ email, password: hashedPassword, displayName });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: "Login failed" });
      res.json({ ok: true });
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// Forgot Password
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

// Reset Password
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
let content = readJson(CONTENT_FILE);
let applications = readJson(APPLICATIONS_FILE);
let runtime = readJson(RUNTIME_FILE);

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
