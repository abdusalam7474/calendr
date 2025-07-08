const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendBookingEmails, sendCancellationEmails } = require('../services/emailService');
const { fromZonedTime, format, formatInTimeZone } = require('date-fns-tz');
const { addHours } = require('date-fns');

// === GET ALL APPOINTMENTS ===
// ... (no changes here)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM appointments ORDER BY appointment_date DESC');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching appointments' });
  }
});

// === GET APPOINTMENTS FOR A SPECIFIC DATE ===
// ... (no changes here)
router.get('/by-date', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'A date query parameter is required (e.g., ?date=YYYY-MM-DD).' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
    }

    const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
    const startOfDayInAppTz = `${date} 00:00:00`;
    const endOfDayInAppTz = `${date} 23:59:59`;

    const startOfDayUtc = fromZonedTime(startOfDayInAppTz, appDefaultTimezone);
    const endOfDayUtc = fromZonedTime(endOfDayInAppTz, appDefaultTimezone);

    const startUtcForDb = format(startOfDayUtc, 'yyyy-MM-dd HH:mm:ss');
    const endUtcForDb = format(endOfDayUtc, 'yyyy-MM-dd HH:mm:ss');

    const [appointments] = await db.query(
      'SELECT * FROM appointments WHERE appointment_date BETWEEN ? AND ? ORDER BY appointment_date ASC',
      [startUtcForDb, endUtcForDb]
    );

    if (appointments.length === 0) {
      return res.status(404).json({ 
        message: `No meeting was booked for the date ${date}.` 
      });
    }

    res.json(appointments);

  } catch (error) {
    console.error('Error fetching appointments by date:', error);
    res.status(500).json({ message: 'An error occurred while fetching appointments.' });
  }
});


// === GET ALL BOOKED DATE/TIME SLOTS ===
// ... (no changes here)
router.get('/booked-slots', async (req, res) => {
  try {
    const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;

    if (!appDefaultTimezone) {
      console.error('Server configuration error: DEFAULT_TIMEZONE is not set.');
      return res.status(500).json({ message: 'Server configuration error.' });
    }

    const [rows] = await db.query('SELECT appointment_date FROM appointments ORDER BY appointment_date ASC');

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

// === NEW FUNCTIONALITY: GET ALL CANCELLED APPOINTMENTS ===
router.get('/cancelled', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM cancelled_appointments ORDER BY cancelled_at DESC');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching cancelled appointments' });
    }
});

// === NEW FUNCTIONALITY: GET CANCELLED APPOINTMENTS BY DATE ===
router.get('/cancelled/by-date', async (req, res) => {
    try {
        const { date } = req.query; // e.g., ?date=2024-10-28

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ message: 'A valid date query parameter is required (YYYY-MM-DD).' });
        }

        const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
        const startOfDayUtc = fromZonedTime(`${date} 00:00:00`, appDefaultTimezone);
        const endOfDayUtc = fromZonedTime(`${date} 23:59:59`, appDefaultTimezone);

        const startUtcForDb = format(startOfDayUtc, 'yyyy-MM-dd HH:mm:ss');
        const endUtcForDb = format(endOfDayUtc, 'yyyy-MM-dd HH:mm:ss');

        const [appointments] = await db.query(
          'SELECT * FROM cancelled_appointments WHERE appointment_date BETWEEN ? AND ? ORDER BY appointment_date ASC',
          [startUtcForDb, endUtcForDb]
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


// === CREATE A NEW APPOINTMENT ===
// === MODIFIED: CREATE A NEW APPOINTMENT (and its Thank You Message) ===
router.post('/', async (req, res) => {
  // --- NEW: Accept 'thankYouMessage' in the request body ---
  const { client_name, client_email, appointment_date, details, client_timezone, thankYouMessage } = req.body;
  
  const connection = await db.getConnection(); // Get a connection for the transaction

  try {
    if (!client_name || !client_email || !appointment_date) {
      connection.release();
      return res.status(400).json({ message: 'Name, email, and date are required.' });
    }

    await connection.beginTransaction();

    const sourceTimezone = client_timezone || process.env.DEFAULT_TIMEZONE;
    const utcDate = fromZonedTime(appointment_date, sourceTimezone);
    const dbFormattedDate = format(utcDate, 'yyyy-MM-dd HH:mm:ss');
    
    const [existingAppointments] = await connection.query(
      'SELECT id FROM appointments WHERE appointment_date = ?', [dbFormattedDate]
    );

    if (existingAppointments.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ message: 'This time slot is already booked.' });
    }

    const newAppointmentData = { client_name, client_email, appointment_date: dbFormattedDate, details };
    const [result] = await connection.query('INSERT INTO appointments SET ?', newAppointmentData);
    const newAppointmentId = result.insertId;

    // --- NEW: Schedule the thank you message ---
    const thankYouSendTime = addHours(utcDate, 24); // Calculate send time: 24 hours after appointment
    const dbFormattedThankYouTime = format(thankYouSendTime, 'yyyy-MM-dd HH:mm:ss');
    
    await connection.query(
      'INSERT INTO thank_you_messages (appointment_id, send_time, message) VALUES (?, ?, ?)',
      [newAppointmentId, dbFormattedThankYouTime, thankYouMessage || null]
    );
    // --- End of new logic ---

    await connection.commit(); // Commit both inserts

    const createdAppointment = { id: newAppointmentId, ...newAppointmentData, appointment_date: utcDate };
    sendBookingEmails(createdAppointment, sourceTimezone).catch(console.error);

    res.status(201).json({ 
        message: 'Appointment created successfully!', 
        appointment: { ...createdAppointment, appointment_date: dbFormattedDate } 
    });

  } catch (error) {
    await connection.rollback(); // Rollback on any error
    if (error instanceof RangeError) {
        return res.status(400).json({ message: 'Invalid timezone or date format provided.' });
    }
    console.error(error);
    res.status(500).json({ message: 'Error creating appointment' });
  } finally {
      if (connection) connection.release();
  }
});



// === MODIFIED FUNCTIONALITY: CANCEL AN APPOINTMENT (MOVE TO CANCELLED TABLE) ===
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  // --- NEW: Get the optional message from the request body ---
  const { cancellationMessage } = req.body;
  
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT * FROM appointments WHERE id = ? FOR UPDATE', [id]);
    
    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    
    const appointmentToCancel = rows[0];

    await connection.query('INSERT INTO cancelled_appointments SET ?', {
        id: appointmentToCancel.id,
        client_name: appointmentToCancel.client_name,
        client_email: appointmentToCancel.client_email,
        appointment_date: appointmentToCancel.appointment_date,
        details: appointmentToCancel.details,
        created_at: appointmentToCancel.created_at
    });

    await connection.query('DELETE FROM appointments WHERE id = ?', [id]);
    await connection.commit();

    // --- MODIFIED: Pass the cancellationMessage to the email function ---
    sendCancellationEmails(appointmentToCancel, cancellationMessage).catch(console.error);

    res.json({ message: 'Appointment cancelled successfully and moved to history.' });

  } catch (error) {
    await connection.rollback();
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Error cancelling appointment' });
  } finally {
    connection.release();
  }
});

module.exports = router;