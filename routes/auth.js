const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../services/emailService');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// @desc    Register a new admin
// @route   POST /api/auth/signup
// @access  Public
router.post('/signup', async (req, res) => {
  const { name, email, password, notification_email, unique_link_slug } = req.body;

  if (!name || !email || !password || !notification_email || !unique_link_slug) {
    return res.status(400).json({ message: 'Please provide name, email, password, notification email, and a unique link slug.' });
  }
  
  if (!/^[a-z0-9-]+$/.test(unique_link_slug)) {
    return res.status(400).json({ message: 'Unique link slug can only contain lowercase letters, numbers, and hyphens.' });
  }

  try {
    const [existingAdmin] = await db.query('SELECT id FROM admins WHERE email = ? OR unique_link_slug = ?', [email, unique_link_slug]);
    if (existingAdmin.length > 0) {
      return res.status(400).json({ message: 'An admin with this email or link slug already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await db.query(
      'INSERT INTO admins (name, email, password, notification_email, unique_link_slug) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, notification_email, unique_link_slug]
    );

    const adminId = result.insertId;

    res.status(201).json({
        message: 'Admin registered successfully.',
        token: generateToken(adminId),
    });

  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ message: 'Server error during signup.' });
  }
});

// @desc    Authenticate admin & get token
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Please provide email and password.' });
    }

    try {
        const [admins] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
        const admin = admins[0];

        if (admin && (await bcrypt.compare(password, admin.password))) {
            const { password, ...adminDetails } = admin; // Exclude password from response
            res.json({
                message: 'Login successful.',
                token: generateToken(admin.id),
                admin: adminDetails
            });
        } else {
            res.status(401).json({ message: 'Invalid credentials.' });
        }
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});


// @desc    Delete the logged-in admin's account
// @route   DELETE /api/auth/delete-account
// @access  Protected
router.delete('/delete-account', protect, async (req, res) => {
  const adminId = req.admin.id; // From protect middleware
  const { password } = req.body;

  if (!password) {
      return res.status(400).json({ message: 'Password is required to delete your account.' });
  }

  const connection = await db.getConnection();
  try {
      await connection.beginTransaction();

      // 1. Get the admin's hashed password from the DB to verify
      const [rows] = await connection.query('SELECT password FROM admins WHERE id = ?', [adminId]);
      
      if (rows.length === 0) {
          // This should not happen if the token is valid, but it's a good safeguard
          await connection.rollback();
          return res.status(404).json({ message: 'Admin not found.' });
      }

      const admin = rows[0];

      // 2. Compare the provided password with the stored hash
      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
          await connection.rollback();
          return res.status(401).json({ message: 'Invalid password. Account not deleted.' });
      }

      // 3. Delete the admin from the database
      // Your database schema's ON DELETE CASCADE constraints will automatically handle
      // deleting all related slugs, appointments, custom data, reminders, etc.
      await connection.query('DELETE FROM admins WHERE id = ?', [adminId]);

      await connection.commit();

      res.status(200).json({ message: 'Your account and all associated data have been permanently deleted.' });

  } catch (error) {
      if (connection) await connection.rollback();
      console.error('Account Deletion Error:', error);
      res.status(500).json({ message: 'An error occurred while deleting your account.' });
  } finally {
      if (connection) connection.release();
  }
});

// @desc    Request a password reset link
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
      return res.status(400).json({ message: 'Please provide an email address.' });
  }

  try {
      const [admins] = await db.query('SELECT id, email FROM admins WHERE email = ?', [email]);
      const admin = admins[0];

      // IMPORTANT: Always send a success-like response to prevent attackers from
      // checking which emails are registered in the system (email enumeration).
      const successResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };

      if (!admin) {
          return res.status(200).json(successResponse);
      }

      // 1. Generate a user-facing token and a database-stored hashed token.
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // 2. Set token expiry to 1 hour from now.
      const resetExpires = new Date(Date.now() + 3600000); 

      // 3. Save the hashed token and its expiry to the database for the user.
      await db.query(
          'UPDATE admins SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
          [hashedToken, resetExpires, admin.id]
      );

      // 4. Send the email with the original (non-hashed) token.
      await sendPasswordResetEmail(admin.email, resetToken);
      
      res.status(200).json(successResponse);

  } catch (error) {
      console.error('Forgot Password Error:', error);
      // Do not expose server errors.
      res.status(500).json({ message: 'An error occurred while processing your request.' });
  }
});


// --- NEW ROUTE ---
// @desc    Reset password using a token
// @route   POST /api/auth/reset-password/:token
// @access  Public
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password) {
      return res.status(400).json({ message: 'Please provide a new password.' });
  }

  // Hash the incoming token so we can match it to the one in the database.
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  try {
      // Find the user by the hashed token and ensure the token has not expired.
      const [admins] = await db.query(
          'SELECT * FROM admins WHERE password_reset_token = ? AND password_reset_expires > NOW()',
          [hashedToken]
      );

      const admin = admins[0];

      if (!admin) {
          return res.status(400).json({ message: 'Password reset token is invalid or has expired.' });
      }

      // Hash the new password.
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Update the password and, crucially, clear the reset token fields to invalidate it.
      await db.query(
          'UPDATE admins SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
          [hashedPassword, admin.id]
      );

      res.status(200).json({ message: 'Password has been reset successfully.' });

  } catch (error) {
      console.error('Reset Password Error:', error);
      res.status(500).json({ message: 'Server error during password reset.' });
  }
});

module.exports = router;