const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendCancellationEmails } = require('../services/emailService');
const { fromZonedTime, format, formatInTimeZone } = require('date-fns-tz');

// NOTE: All routes in this file are now protected and will only affect
// the data of the currently logged-in admin.
// The `req.admin` object is available from the `protect` middleware.


// === GET ALL APPOINTMENTS for the logged-in admin ===
router.get('/', async (req, res) => {
  const adminId = req.admin.id;
  try {
    const [rows] = await db.query(
        'SELECT * FROM appointments WHERE admin_id = ? ORDER BY appointment_date DESC', 
        [adminId]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching appointments' });
  }
});

// === GET APPOINTMENTS FOR A SPECIFIC DATE for the logged-in admin ===
router.get('/by-date', async (req, res) => {
  const adminId = req.admin.id;
  try {
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'A valid date query parameter is required (YYYY-MM-DD).' });
    }

    const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
    const startOfDayUtc = fromZonedTime(`${date} 00:00:00`, appDefaultTimezone);
    const endOfDayUtc = fromZonedTime(`${date} 23:59:59`, appDefaultTimezone);

    const startUtcForDb = format(startOfDayUtc, 'yyyy-MM-dd HH:mm:ss');
    const endUtcForDb = format(endOfDayUtc, 'yyyy-MM-dd HH:mm:ss');

    const [appointments] = await db.query(
      'SELECT * FROM appointments WHERE admin_id = ? AND appointment_date BETWEEN ? AND ? ORDER BY appointment_date ASC',
      [adminId, startUtcForDb, endUtcForDb]
    );

    if (appointments.length === 0) {
      return res.status(404).json({ message: `No appointments found for the date ${date}.` });
    }

    res.json(appointments);

  } catch (error) {
    console.error('Error fetching appointments by date:', error);
    res.status(500).json({ message: 'An error occurred while fetching appointments.' });
  }
});


// @desc    Get full details of a single appointment, including custom data
// @route   GET /api/appointments/:appointmentId/details
// @access  Protected
router.get('/:appointmentId/details', async (req, res) => {
  const adminId = req.admin.id;
  const { appointmentId } = req.params;

  try {
      // First, get the core appointment details and verify ownership by the logged-in admin.
      const [appointments] = await db.query(
          `SELECT 
              a.id, 
              a.client_name, 
              a.client_email, 
              a.appointment_date, 
              a.details, 
              a.created_at, 
              s.slug as booking_page_slug
          FROM appointments a
          LEFT JOIN slugs s ON a.slug_id = s.id
          WHERE a.id = ? AND a.admin_id = ?`,
          [appointmentId, adminId]
      );

      if (appointments.length === 0) {
          return res.status(404).json({ message: 'Appointment not found or you do not have permission to view it.' });
      }
      const appointmentDetails = appointments[0];

      // Now, get the custom field data associated with this appointment.
      const [customData] = await db.query(
          `SELECT 
              sf.field_label, 
              acd.field_value 
          FROM appointment_custom_data acd
          JOIN slug_fields sf ON acd.slug_field_id = sf.id
          WHERE acd.appointment_id = ?`,
          [appointmentId]
      );
      
      // Combine the core details with the custom data for a complete response.
      const response = {
          ...appointmentDetails,
          custom_data: customData
      };

      res.json(response);

  } catch (error) {
      console.error('Error fetching appointment details:', error);
      res.status(500).json({ message: 'An error occurred while fetching appointment details.' });
  }
});


// === GET ALL BOOKED DATE/TIME SLOTS for the logged-in admin ===
router.get('/booked-slots', async (req, res) => {
  const adminId = req.admin.id; // Get the admin ID from the token
  try {
    const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;

    if (!appDefaultTimezone) {
      console.error('Server configuration error: DEFAULT_TIMEZONE is not set.');
      return res.status(500).json({ message: 'Server configuration error.' });
    }
    
    // The query now securely filters by the logged-in admin's ID
    const [rows] = await db.query(
        'SELECT appointment_date FROM appointments WHERE admin_id = ? ORDER BY appointment_date ASC', 
        [adminId]
    );

    const bookedSlots = rows.map(row => 
      formatInTimeZone(row.appointment_date, appDefaultTimezone, 'yyyy-MM-dd HH:mm:ss')
    );

    res.json({
      timezone: appDefaultTimezone,
      bookedSlots: bookedSlots,
    });

  } catch (error) {
    console.error('Error fetching booked slots:', error);
    res.status(500).json({ message: 'Error fetching booked slots' });
  }
});

// === GET ALL CANCELLED APPOINTMENTS for the logged-in admin ===
router.get('/cancelled', async (req, res) => {
    const adminId = req.admin.id;
    try {
        const [rows] = await db.query(
            'SELECT * FROM cancelled_appointments WHERE admin_id = ? ORDER BY cancelled_at DESC',
            [adminId]
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching cancelled appointments' });
    }
});

// === GET CANCELLED APPOINTMENTS BY DATE for the logged-in admin ===
router.get('/cancelled/by-date', async (req, res) => {
    const adminId = req.admin.id;
    try {
        const { date } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ message: 'A valid date query parameter is required (YYYY-MM-DD).' });
        }

        const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
        const startOfDayUtc = fromZonedTime(`${date} 00:00:00`, appDefaultTimezone);
        const endOfDayUtc = fromZonedTime(`${date} 23:59:59`, appDefaultTimezone);
        const startUtcForDb = format(startOfDayUtc, 'yyyy-MM-dd HH:mm:ss');
        const endUtcForDb = format(endOfDayUtc, 'yyyy-MM-dd HH:mm:ss');

        const [appointments] = await db.query(
          'SELECT * FROM cancelled_appointments WHERE admin_id = ? AND appointment_date BETWEEN ? AND ? ORDER BY appointment_date ASC',
          [adminId, startUtcForDb, endUtcForDb]
        );

        if (appointments.length === 0) {
            return res.status(404).json({ message: `No cancelled appointments found for the date ${date}.` });
        }

        res.json(appointments);
    } catch (error) {
        console.error('Error fetching cancelled appointments by date:', error);
        res.status(500).json({ message: 'An error occurred while fetching cancelled appointments.' });
    }
});

// === CANCEL AN APPOINTMENT for the logged-in admin ===
// === CANCEL AN APPOINTMENT for the logged-in admin ===
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const adminId = req.admin.id;
  const adminNotificationEmail = req.admin.notification_email;
  const { cancellationMessage } = req.body;
  
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
        'SELECT * FROM appointments WHERE id = ? AND admin_id = ? FOR UPDATE', 
        [id, adminId]
    );
    
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Appointment not found or you do not have permission to cancel it.' });
    }
    
    const appointmentToCancel = rows[0];

    // MODIFIED: Also move the slug_id to the cancelled_appointments table
    await connection.query('INSERT INTO cancelled_appointments SET ?', {
        id: appointmentToCancel.id,
        admin_id: appointmentToCancel.admin_id,
        slug_id: appointmentToCancel.slug_id, // <-- ADDED THIS LINE
        client_name: appointmentToCancel.client_name,
        client_email: appointmentToCancel.client_email,
        appointment_date: appointmentToCancel.appointment_date,
        details: appointmentToCancel.details,
        created_at: appointmentToCancel.created_at
    });

    await connection.query('DELETE FROM appointments WHERE id = ?', [id]);
    await connection.commit();

    sendCancellationEmails(appointmentToCancel, cancellationMessage, adminNotificationEmail).catch(console.error);

    res.json({ message: 'Appointment cancelled successfully and moved to history.' });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Error cancelling appointment' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;