const express = require('express');
const db = require('../config/db');
const { fromZonedTime, format } = require('date-fns-tz');

const router = express.Router({ mergeParams: true });

// MODIFIED: Helper function to get an appointment AND verify it belongs to the logged-in admin
async function getAppointmentAndVerifyOwner(appointmentId, adminId) {
    const [rows] = await db.query(
        'SELECT * FROM appointments WHERE id = ? AND admin_id = ?', 
        [appointmentId, adminId]
    );
    return rows[0];
}

// === CREATE A NEW REMINDER ===
router.post('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const adminId = req.admin.id;
        const { reminder_time, client_timezone, message } = req.body;

        if (!reminder_time) {
            return res.status(400).json({ message: 'reminder_time is required.' });
        }

        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
        }

        const sourceTimezone = client_timezone || process.env.DEFAULT_TIMEZONE;
        const utcReminderTime = fromZonedTime(reminder_time, sourceTimezone);
        
        if (utcReminderTime >= appointment.appointment_date) {
            return res.status(400).json({ message: 'Reminder time must be set before the appointment time.' });
        }

        const dbFormattedReminderTime = format(utcReminderTime, 'yyyy-MM-dd HH:mm:ss');
        
        const [result] = await db.query(
            'INSERT INTO reminders (appointment_id, reminder_time, message) VALUES (?, ?, ?)',
            [appointmentId, dbFormattedReminderTime, message || null]
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

// === GET ALL REMINDERS FOR AN APPOINTMENT ===
router.get('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const adminId = req.admin.id;
        
        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
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

// === UPDATE A REMINDER ===
router.put('/:reminderId', async (req, res) => {
    try {
        const { appointmentId, reminderId } = req.params;
        const adminId = req.admin.id;
        const { reminder_time, client_timezone, message } = req.body;

        if (!reminder_time && message === undefined) {
             return res.status(400).json({ message: 'Either reminder_time or message must be provided for an update.' });
        }

        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
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


// === DELETE A REMINDER ===
router.delete('/:reminderId', async (req, res) => {
    try {
        const { appointmentId, reminderId } = req.params;
        const adminId = req.admin.id;

        // First, ensure the appointment belongs to the admin. This is an indirect way
        // to ensure they can't delete reminders for other admins' appointments.
        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
        }

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