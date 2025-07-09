const express = require('express');
const cors = require('cors');
require('dotenv').config();

// --- NEW: Import middleware and new routes ---
const { protect } = require('./middleware/authMiddleware');
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');

// Import existing routes
const appointmentRoutes = require('./routes/appointments');
const reminderRoutes = require('./routes/reminders');

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

// --- NEW ROUTE SETUP ---

// Public routes for client booking and admin authentication
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);

// Protected routes for admin management.
// All routes defined in 'appointmentRoutes' and 'reminderRoutes' will now require a valid token.
app.use('/api/appointments', protect, appointmentRoutes);
app.use('/api/appointments/:appointmentId/reminders', protect, reminderRoutes);


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
  // Initialize the background jobs
  initializeReminderJob();
  initializeThankYouJob();
});