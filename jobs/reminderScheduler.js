const cron = require('node-cron');
const db = require('../config/db');
const { sendReminderEmail } = require('../services/emailService');

async function checkAndSendReminders() {
  console.log('Running reminder check...');
  
  // --- THIS IS THE MODIFIED QUERY ---
  const query = `
    SELECT
      r.id as reminder_id,
      r.reminder_time,
      r.message,
      a.id as appointment_id,
      a.client_name,
      a.client_email,
      a.appointment_date,
      a.details
    FROM reminders r
    JOIN appointments a ON r.appointment_id = a.id
    WHERE r.status = 'pending' AND r.reminder_time <= UTC_TIMESTAMP()
  `;
  // --- END OF MODIFICATION ---
  
  try {
    const [dueReminders] = await db.query(query);

    if (dueReminders.length === 0) {
      console.log('No due reminders found.');
      return;
    }

    console.log(`Found ${dueReminders.length} due reminders.`);

    for (const reminder of dueReminders) {
      const wasSent = await sendReminderEmail(reminder);

      const newStatus = wasSent ? 'sent' : 'failed';
      await db.query(
        'UPDATE reminders SET status = ? WHERE id = ?',
        [newStatus, reminder.reminder_id]
      );
    }
  } catch (error) {
    console.error('An error occurred during the reminder check job:', error);
  }
}

function initializeReminderJob() {
  cron.schedule('*/1 * * * *', checkAndSendReminders, {
    scheduled: true,
    timezone: "Etc/UTC"
  });
  console.log('Reminder scheduler has been initialized. Will run every minute.');
}

module.exports = { initializeReminderJob };