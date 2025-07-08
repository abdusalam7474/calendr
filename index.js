const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import routes
const appointmentRoutes = require('./routes/appointments');
const reminderRoutes = require('./routes/reminders');

// --- NEW: Import the scheduler initializer ---
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
  res.send('Welcome to the Meeting Booking API!');
});

// Use the appointment routes
app.use('/api/appointments', appointmentRoutes);
app.use('/api/appointments/:appointmentId/reminders', reminderRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
  // --- NEW: Initialize the background job when the server is ready ---
  initializeReminderJob();
  initializeThankYouJob();
});