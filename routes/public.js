const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendBookingEmails } = require('../services/emailService');
const { fromZonedTime, format, formatInTimeZone } = require('date-fns-tz');
const { addHours } = require('date-fns');

// --- MODIFIED HELPER FUNCTION ---
// Now finds the admin by their profile slug, then finds the booking page by its slug for that admin.
async function getBookingPageDetails(adminSlug, bookingSlug) {
    // 1. Find the admin using their unique profile slug.
    const [admins] = await db.query(
        'SELECT id, notification_email FROM admins WHERE unique_link_slug = ?', 
        [adminSlug]
    );

    if (admins.length === 0) {
        // Admin profile not found
        return null; 
    }
    const admin = admins[0];

    // 2. Find the specific booking page that belongs to this admin.
    const [pages] = await db.query(
        'SELECT id as slug_id, slug FROM slugs WHERE admin_id = ? AND slug = ?',
        [admin.id, bookingSlug]
    );

    if (pages.length === 0) {
        // This admin does not have a booking page with this slug
        return null;
    }
    const page = pages[0];

    // 3. Get the custom fields for that specific booking page.
    const [fields] = await db.query(
        'SELECT id, field_name, field_label, field_type, is_required FROM slug_fields WHERE slug_id = ?',
        [page.slug_id]
    );
    
    // 4. Combine all details into a single object.
    return {
        admin_id: admin.id,
        notification_email: admin.notification_email,
        slug_id: page.slug_id,
        slug: page.slug,
        fields: fields
    };
}


// @desc    Get the form fields for a specific booking slug
// @route   GET /api/public/:adminSlug/:bookingSlug/form
// @access  Public
router.get('/:adminSlug/:bookingSlug/form', async (req, res) => {
    try {
        const { adminSlug, bookingSlug } = req.params;
        const page = await getBookingPageDetails(adminSlug, bookingSlug);

        if (!page) {
            return res.status(404).json({ message: 'This booking link is not valid.' });
        }

        const compulsoryFields = [
            { field_name: 'client_name', field_label: 'Your Name', field_type: 'text', is_required: true },
            { field_name: 'client_email', field_label: 'Your Email', field_type: 'email', is_required: true },
        ];

        res.json({
            slug: page.slug,
            fields: [...compulsoryFields, ...page.fields],
        });

    } catch (error) {
        console.error('Error fetching form fields:', error);
        res.status(500).json({ message: 'Error fetching booking page details' });
    }
});


// @desc    Get all booked time slots for a specific slug
// @route   GET /api/public/:adminSlug/:bookingSlug/booked-slots
// @access  Public
router.get('/:adminSlug/:bookingSlug/booked-slots', async (req, res) => {
  try {
    const { adminSlug, bookingSlug } = req.params;
    const page = await getBookingPageDetails(adminSlug, bookingSlug);

    if (!page) {
        return res.status(404).json({ message: 'This booking link is not valid.' });
    }

    const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;

    // The query now uses both admin_id and slug_id to be absolutely specific.
    const [rows] = await db.query(
        'SELECT appointment_date FROM appointments WHERE admin_id = ? AND slug_id = ? ORDER BY appointment_date ASC', 
        [page.admin_id, page.slug_id]
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


// @desc    Create a new appointment using a slug
// @route   POST /api/public/:adminSlug/:bookingSlug/book
// @access  Public
router.post('/:adminSlug/:bookingSlug/book', async (req, res) => {
    const { adminSlug, bookingSlug } = req.params;
    const { client_name, client_email, appointment_date, client_timezone, details, ...custom_fields } = req.body;
    
    const connection = await db.getConnection();

    try {
        const page = await getBookingPageDetails(adminSlug, bookingSlug);
        if (!page) {
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
        
        // --- MODIFIED LOGIC ---
        // The query now checks for any appointment for the admin at the given time,
        // across ALL of their booking slugs.
        const [existingAppointments] = await connection.query(
            'SELECT id FROM appointments WHERE appointment_date = ? AND admin_id = ?', 
            [dbFormattedDate, page.admin_id] // <-- REMOVED page.slug_id
        );

        if (existingAppointments.length > 0) { // <-- Use the new variable name
            await connection.rollback();
            connection.release(); // Release connection before sending response
            return res.status(409).json({ message: 'This time slot is already booked for this provider.' });
        }
        // --- END OF MODIFICATION ---

        const apptData = { admin_id: page.admin_id, slug_id: page.slug_id, client_name, client_email, appointment_date: dbFormattedDate, details };
        const [result] = await connection.query('INSERT INTO appointments SET ?', apptData);
        const newAppointmentId = result.insertId;
        
        // ... (The rest of the function remains the same) ...
        const customFieldData = [];
        for (const field of page.fields) {
            if (custom_fields[field.field_name]) {
                customFieldData.push([newAppointmentId, field.id, custom_fields[field.field_name]]);
            }
        }
        if (customFieldData.length > 0) {
            await connection.query('INSERT INTO appointment_custom_data (appointment_id, slug_field_id, field_value) VALUES ?', [customFieldData]);
        }

        const thankYouSendTime = addHours(utcDate, 24);
        await connection.query(
            'INSERT INTO thank_you_messages (appointment_id, send_time, message) VALUES (?, ?, ?)',
            [newAppointmentId, format(thankYouSendTime, 'yyyy-MM-dd HH:mm:ss'), null]
        );
        
        await connection.commit();

        const createdAppointment = { id: newAppointmentId, ...apptData, appointment_date: utcDate };
        
        const customDataForEmail = {};
        page.fields.forEach(f => {
            if (custom_fields[f.field_name]) {
                customDataForEmail[f.field_label] = custom_fields[f.field_name];
            }
        });
        
        sendBookingEmails(createdAppointment, sourceTimezone, page.notification_email, customDataForEmail).catch(console.error);

        res.status(201).json({ message: 'Appointment created successfully!' });

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