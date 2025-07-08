const cron = require('node-cron');
const db = require('../config/db');
const { sendThankYouEmail } = require('../services/emailService');

async function checkAndSendThankYous() {
  console.log('Running thank you message check...');
  
  const query = `
    SELECT
      ty.id,
      ty.message,
      a.client_name,
      a.client_email,
      a.appointment_date
    FROM thank_you_messages ty
    JOIN appointments a ON ty.appointment_id = a.id
    WHERE ty.status = 'pending' AND ty.send_time <= UTC_TIMESTAMP()
  `;
  
  try {
    const [dueMessages] = await db.query(query);

    if (dueMessages.length === 0) {
      console.log('No due thank you messages found.');
      return;
    }

    console.log(`Found ${dueMessages.length} due thank you messages.`);

    for (const msg of dueMessages) {
      const wasSent = await sendThankYouEmail(msg);
      const newStatus = wasSent ? 'sent' : 'failed';
      await db.query(
        'UPDATE thank_you_messages SET status = ? WHERE id = ?',
        [newStatus, msg.id]
      );
    }
  } catch (error) {
    console.error('An error occurred during the thank you check job:', error);
  }
}

// We can run this less frequently, e.g., every 10 minutes, as it's not as time-sensitive.
function initializeThankYouJob() {
  cron.schedule('*/10 * * * *', checkAndSendThankYous, {
    scheduled: true,
    timezone: "Etc/UTC"
  });
  console.log('Thank You scheduler has been initialized. Will run every 10 minutes.');
}

module.exports = { initializeThankYouJob };