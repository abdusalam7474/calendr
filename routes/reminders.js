const express = require('express');
const db = require('../config/db');
const { fromZonedTime, format } = require('date-fns-tz');

const router = express.Router({ mergeParams: true });

async function getAppointment(appointmentId) {
    const [rows] = await db.query('SELECT * FROM appointments WHERE id = ?', [appointmentId]);
    return rows[0];
}

// === CREATE A NEW REMINDER (with optional message) ===
router.post('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        // --- NEW: Destructure 'message' from the body ---
        const { reminder_time, client_timezone, message } = req.body;

        if (!reminder_time) {
            return res.status(400).json({ message: 'reminder_time is required.' });
        }

        const appointment = await getAppointment(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found.' });
        }

        const sourceTimezone = client_timezone || process.env.DEFAULT_TIMEZONE;
        const utcReminderTime = fromZonedTime(reminder_time, sourceTimezone);
        
        if (utcReminderTime >= appointment.appointment_date) {
            return res.status(400).json({ message: 'Reminder time must be set before the appointment time.' });
        }

        const dbFormattedReminderTime = format(utcReminderTime, 'yyyy-MM-dd HH:mm:ss');
        
        // --- MODIFIED: Include message in the INSERT query ---
        const [result] = await db.query(
            'INSERT INTO reminders (appointment_id, reminder_time, message) VALUES (?, ?, ?)',
            [appointmentId, dbFormattedReminderTime, message || null] // Pass message or null
        );

        res.status(201).json({
            id: result.insertId,
            appointment_id: parseInt(appointmentId, 10),
            reminder_time: dbFormattedReminderTime,
            message: message || null,
            status: 'pending'
        });

    } catch (error) {
        if (error instanceof RangeError) {
            return res.status(400).json({ message: 'Invalid timezone or date format provided.' });
        }
        console.error('Error creating reminder:', error);
        res.status(500).json({ message: 'Error creating reminder.' });
    }
});

// === GET ALL REMINDERS FOR AN APPOINTMENT (no change needed) ===
router.get('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        
        const appointment = await getAppointment(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found.' });
        }

        const [reminders] = await db.query(
            'SELECT * FROM reminders WHERE appointment_id = ? ORDER BY reminder_time ASC',
            [appointmentId]
        );
        
        res.json(reminders);

    } catch (error) {
        console.error('Error fetching reminders:', error);
        res.status(500).json({ message: 'Error fetching reminders.' });
    }
});

// === UPDATE A REMINDER (with optional message) ===
router.put('/:reminderId', async (req, res) => {
    try {
        const { appointmentId, reminderId } = req.params;
        // --- NEW: Destructure 'message' from body ---
        const { reminder_time, client_timezone, message } = req.body;

        // --- MODIFIED: Allow updating time, message, or both ---
        if (!reminder_time && message === undefined) {
             return res.status(400).json({ message: 'Either reminder_time or message must be provided for an update.' });
        }

        const appointment = await getAppointment(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found.' });
        }

        const updateFields = [];
        const updateValues = [];

        if (reminder_time) {
            const sourceTimezone = client_timezone || process.env.DEFAULT_TIMEZONE;
            const utcReminderTime = fromZonedTime(reminder_time, sourceTimezone);

            if (utcReminderTime >= appointment.appointment_date) {
                return res.status(400).json({ message: 'Reminder time must be set before the appointment time.' });
            }
            updateFields.push('reminder_time = ?');
            updateValues.push(format(utcReminderTime, 'yyyy-MM-dd HH:mm:ss'));
        }

        // message === undefined checks if the key wasn't sent at all.
        // This allows sending `message: null` to clear it.
        if (message !== undefined) {
            updateFields.push('message = ?');
            updateValues.push(message);
        }

        const [result] = await db.query(
            `UPDATE reminders SET ${updateFields.join(', ')} WHERE id = ? AND appointment_id = ?`,
            [...updateValues, reminderId, appointmentId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Reminder not found for this appointment.' });
        }

        res.json({ message: 'Reminder updated successfully.' });

    } catch (error) {
        if (error instanceof RangeError) {
            return res.status(400).json({ message: 'Invalid timezone or date format provided.' });
        }
        console.error('Error updating reminder:', error);
        res.status(500).json({ message: 'Error updating reminder.' });
    }
});


// === DELETE A REMINDER (no change needed) ===
router.delete('/:reminderId', async (req, res) => {
    try {
        const { appointmentId, reminderId } = req.params;

        const [result] = await db.query(
            'DELETE FROM reminders WHERE id = ? AND appointment_id = ?',
            [reminderId, appointmentId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Reminder not found for this appointment.' });
        }

        res.json({ message: 'Reminder deleted successfully.' });

    } catch (error) {
        console.error('Error deleting reminder:', error);
        res.status(500).json({ message: 'Error deleting reminder.' });
    }
});

module.exports = router;