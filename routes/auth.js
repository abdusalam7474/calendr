const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

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

module.exports = router;