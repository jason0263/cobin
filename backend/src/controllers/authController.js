// backend/src/controllers/authController.js

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const EmailVerificationToken = require('../models/EmailVerificationToken');
const PasswordResetToken = require('../models/PasswordResetToken');
const nodemailer = require('nodemailer');

// Setup nodemailer transporter from env variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Helper to send email
async function sendMail(to, subject, html) {
  await transporter.sendMail({
    from: `"No Reply" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

// Generate JWT
function generateToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

// Register controller
exports.register = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    // Basic validation
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    // Check email & username uniqueness
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(409).json({ message: 'This email is already registered. Please login instead.' });
      }
      return res.status(409).json({ message: 'Username already taken.' });
    }
    // Password strength (minimum 8 chars, at least one letter and one number)
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters, contain letters and numbers.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, username, passwordHash, status: 'offline' });

    // Create email verification token (hashed in DB)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await EmailVerificationToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
    });

    const verificationUrl = `${req.protocol}://${req.get('host')}/api/auth/verify-email/${rawToken}`;
    await sendMail(
      user.email,
      'Verify your email',
      `<p>Click <a href="${verificationUrl}">here</a> to verify your email. This link expires in 24 hours.</p>`
    );

    res.status(201).json({ message: 'Registration successful. Please verify your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Email verification controller
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await EmailVerificationToken.findOne({ tokenHash, expiresAt: { $gt: Date.now() } });
    if (!record) {
      return res.status(400).json({ message: 'Invalid or expired verification token.' });
    }
    await User.findByIdAndUpdate(record.userId, { emailVerified: true });
    await EmailVerificationToken.deleteOne({ _id: record._id });
    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Login controller
exports.login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      // Do not reveal whether email exists
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    if (!user.emailVerified) {
      return res.status(403).json({ message: 'Please verify your email before logging in.' });
    }
    const token = generateToken(user);
    // HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : undefined,
    });
    // Update status
    user.status = 'online';
    user.lastLoginAt = Date.now();
    await user.save();
    res.json({ message: 'Login successful.', user: { id: user._id, username: user.username, avatar: user.avatar, status: user.status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Logout controller
exports.logout = async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (token) {
      res.clearCookie('token');
    }
    // Optionally set user status offline if we can determine user from token
    const decoded = token && jwt.verify(token, process.env.JWT_SECRET);
    if (decoded) {
      await User.findByIdAndUpdate(decoded.id, { status: 'offline' });
    }
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Get current user (protected)
exports.getCurrentUser = async (req, res) => {
  try {
    const userId = req.userId; // set by auth middleware
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Forgot password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' }); // avoid enumeration
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
    });
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${rawToken}`;
    await sendMail(
      user.email,
      'Password Reset',
      `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`
    );
    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;
    if (!password || !confirmPassword) return res.status(400).json({ message: 'All fields are required.' });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' });
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters, contain letters and numbers.' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await PasswordResetToken.findOne({ tokenHash, expiresAt: { $gt: Date.now() } });
    if (!record) return res.status(400).json({ message: 'Invalid or expired reset token.' });
    const passwordHash = await bcrypt.hash(password, 12);
    await User.findByIdAndUpdate(record.userId, { passwordHash });
    await PasswordResetToken.deleteOne({ _id: record._id });
    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};
