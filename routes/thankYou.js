const express = require('express');
const db = require('../config/db');
const { fromZonedTime, format } = require('date-fns-tz');

// Use mergeParams to access :appointmentId from the parent router
const router = express.Router({ mergeParams: true });

// Helper to get an appointment AND verify it belongs to the logged-in admin
async function getAppointmentAndVerifyOwner(appointmentId, adminId) {
    const [rows] = await db.query(
        'SELECT * FROM appointments WHERE id = ? AND admin_id = ?', 
        [appointmentId, adminId]
    );
    return rows[0];
}

// @desc    Get the thank you message details for an appointment
// @route   GET /api/appointments/:appointmentId/thank-you
// @access  Protected
router.get('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const adminId = req.admin.id;

        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
        }

        const [messages] = await db.query('SELECT * FROM thank_you_messages WHERE appointment_id = ?', [appointmentId]);
        if (messages.length === 0) {
            return res.status(404).json({ message: 'Thank you message not found for this appointment.' });
        }

        res.json(messages[0]);

    } catch (error) {
        console.error('Error fetching thank you message:', error);
        res.status(500).json({ message: 'Error fetching thank you message.' });
    }
});

// @desc    Update the thank you message content and/or send time
// @route   PUT /api/appointments/:appointmentId/thank-you
// @access  Protected
router.put('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const adminId = req.admin.id;
        const { message, send_time, client_timezone } = req.body;

        if (message === undefined && !send_time) {
            return res.status(400).json({ message: 'Either message or send_time must be provided for an update.' });
        }

        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
        }

        const updateFields = [];
        const updateValues = [];

        if (send_time) {
            const sourceTimezone = client_timezone || process.env.DEFAULT_TIMEZONE;
            const utcSendTime = fromZonedTime(send_time, sourceTimezone);
            
            // Validation: Ensure new send time is after the appointment time
            if (utcSendTime <= new Date(appointment.appointment_date)) {
                return res.status(400).json({ message: 'Thank you message send time must be after the appointment time.' });
            }

            updateFields.push('send_time = ?');
            updateValues.push(format(utcSendTime, 'yyyy-MM-dd HH:mm:ss'));
        }

        if (message !== undefined) {
            updateFields.push('message = ?');
            updateValues.push(message);
        }
        
        if (updateValues.length === 0) {
            return res.status(400).json({ message: "No valid fields provided for update." });
        }

        updateValues.push(appointmentId); // For the WHERE clause

        const [result] = await db.query(
            `UPDATE thank_you_messages SET ${updateFields.join(', ')} WHERE appointment_id = ?`,
            updateValues
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Thank you message not found for this appointment.' });
        }

        res.json({ message: 'Thank you message updated successfully.' });

    } catch (error) {
        if (error instanceof RangeError) {
            return res.status(400).json({ message: 'Invalid timezone or date format provided.' });
        }
        console.error('Error updating thank you message:', error);
        res.status(500).json({ message: 'Error updating thank you message.' });
    }
});

// @desc    Delete the thank you message for an appointment
// @route   DELETE /api/appointments/:appointmentId/thank-you
// @access  Protected
router.delete('/', async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const adminId = req.admin.id;

        // 1. Verify the admin owns the parent appointment.
        const appointment = await getAppointmentAndVerifyOwner(appointmentId, adminId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found or you do not have permission to access it.' });
        }

        // 2. Delete the thank you message record from the database.
        const [result] = await db.query(
            'DELETE FROM thank_you_messages WHERE appointment_id = ?',
            [appointmentId]
        );

        if (result.affectedRows === 0) {
            // This can happen if it was already deleted, which is not an error.
            return res.status(200).json({ message: 'No thank you message was found to delete.' });
        }

        res.status(200).json({ message: 'Thank you message has been successfully deleted and will not be sent.' });

    } catch (error) {
        console.error('Error deleting thank you message:', error);
        res.status(500).json({ message: 'Error deleting thank you message.' });
    }
});

module.exports = router;