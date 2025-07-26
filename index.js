const express = require('express');
const cors = require('cors');
require('dotenv').config();

// --- Import middleware and new routes ---
const { protect } = require('./middleware/authMiddleware');
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const slugRoutes = require('./routes/slugs'); // <-- NEW: Import slug routes

// Import existing routes
const appointmentRoutes = require('./routes/appointments');
const reminderRoutes = require('./routes/reminders');
const thankYouRoutes = require('./routes/thankYou');

// Import the scheduler initializers
const { initializeReminderJob } = require('./jobs/reminderScheduler');
const { initializeThankYouJob } = require('./jobs/thankYouScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// A simple root route
app.get('/', (req, res) => {
  res.send('Welcome to the Multi-Admin Meeting Booking API!');
});

// --- ROUTE SETUP ---

// Public routes for client booking and admin authentication
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);

// Protected routes for admin management.
// All routes defined below will now require a valid token.
app.use('/api/slugs', protect, slugRoutes); // <-- NEW: Add slug management routes
app.use('/api/appointments', protect, appointmentRoutes);
app.use('/api/appointments/:appointmentId/reminders', protect, reminderRoutes);
app.use('/api/appointments/:appointmentId/thank-you', protect, thankYouRoutes);




// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
  // Initialize the background jobs
  initializeReminderJob();
  initializeThankYouJob();
});