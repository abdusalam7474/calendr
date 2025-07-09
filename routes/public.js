const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendBookingEmails } = require('../services/emailService');
const { fromZonedTime, format, formatInTimeZone } = require('date-fns-tz');
const { addHours } = require('date-fns');

// Helper to get admin by their unique public slug
async function getAdminBySlug(slug) {
    const [admins] = await db.query('SELECT id, notification_email FROM admins WHERE unique_link_slug = ?', [slug]);
    return admins[0];
}

// @desc    Get all booked time slots for a specific admin
// @route   GET /api/public/:slug/booked-slots
// @access  Public
router.get('/:slug/booked-slots', async (req, res) => {
  try {
    const { slug } = req.params;
    const admin = await getAdminBySlug(slug);

    if (!admin) {
        return res.status(404).json({ message: 'This booking link is not valid.' });
    }

    const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;

    const [rows] = await db.query(
        'SELECT appointment_date FROM appointments WHERE admin_id = ? ORDER BY appointment_date ASC', 
        [admin.id]
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

// @desc    Create a new appointment for a specific admin
// @route   POST /api/public/:slug/book
// @access  Public
router.post('/:slug/book', async (req, res) => {
    const { slug } = req.params;
    const { client_name, client_email, appointment_date, details, client_timezone, thankYouMessage } = req.body;
    
    const connection = await db.getConnection();

    try {
        const admin = await getAdminBySlug(slug);
        if (!admin) {
            connection.release();
            return res.status(404).json({ message: 'This booking link is not valid.' });
        }

        if (!client_name || !client_email || !appointment_date) {
            connection.release();
            return res.status(400).json({ message: 'Name, email, and date are required.' });
        }

        await connection.beginTransaction();

        const sourceTimezone = client_timezone || process.env.DEFAULT_TIMEZONE;
        const utcDate = fromZonedTime(appointment_date, sourceTimezone);
        const dbFormattedDate = format(utcDate, 'yyyy-MM-dd HH:mm:ss');
        
        const [existingAppointments] = await connection.query(
            'SELECT id FROM appointments WHERE appointment_date = ? AND admin_id = ?', [dbFormattedDate, admin.id]
        );

        if (existingAppointments.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(409).json({ message: 'This time slot is already booked.' });
        }

        const newAppointmentData = { admin_id: admin.id, client_name, client_email, appointment_date: dbFormattedDate, details };
        const [result] = await connection.query('INSERT INTO appointments SET ?', newAppointmentData);
        const newAppointmentId = result.insertId;

        const thankYouSendTime = addHours(utcDate, 24);
        const dbFormattedThankYouTime = format(thankYouSendTime, 'yyyy-MM-dd HH:mm:ss');
        
        await connection.query(
            'INSERT INTO thank_you_messages (appointment_id, send_time, message) VALUES (?, ?, ?)',
            [newAppointmentId, dbFormattedThankYouTime, thankYouMessage || null]
        );
        
        await connection.commit();

        const createdAppointment = { id: newAppointmentId, ...newAppointmentData, appointment_date: utcDate };
        
        sendBookingEmails(createdAppointment, sourceTimezone, admin.notification_email).catch(console.error);

        res.status(201).json({ 
            message: 'Appointment created successfully!', 
            appointment: { id: newAppointmentId, appointment_date: dbFormattedDate } 
        });

    } catch (error) {
        if(connection) await connection.rollback();
        if (error instanceof RangeError) {
            return res.status(400).json({ message: 'Invalid timezone or date format provided.' });
        }
        console.error(error);
        res.status(500).json({ message: 'Error creating appointment' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;