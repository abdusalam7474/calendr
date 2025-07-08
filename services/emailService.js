const nodemailer = require('nodemailer');
const { formatInTimeZone } = require('date-fns-tz');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ... sendBookingEmails function remains unchanged ...
async function sendBookingEmails(appointmentDetails, clientTimezone) {
  const { id, client_name, client_email, appointment_date, details } = appointmentDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;

  // Format the UTC date into the client's and app's local times
  // The 'p' format token gives 'h:mm a' (e.g., 2:30 PM)
  const dateTimeFormat = 'MMMM d, yyyy \'at\' p'; // e.g., "October 28, 2024 at 2:30 PM"

  const clientLocalTime = formatInTimeZone(appointment_date, clientTimezone, dateTimeFormat);
  const appLocalTime = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

  // 1. Email to the Client (in their timezone)
  const clientMailOptions = {
    from: `"${appName}" <${process.env.EMAIL_USER}>`,
    to: client_email,
    subject: `✅ Your Appointment is Confirmed!`,
    html: `
      <h1>Hi ${client_name},</h1>
      <p>Your appointment has been successfully booked. Here are the details:</p>
      <ul>
        <li><strong>Date & Time:</strong> ${clientLocalTime} (${clientTimezone})</li>
        <li><strong>Details:</strong> ${details || 'N/A'}</li>
      </ul>
      <p>We look forward to meeting with you!</p>
    `,
  };

  // 2. Notification Email to the Special Address (in app's timezone + client's for context)
  const adminMailOptions = {
    from: `"${appName} Booker" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `🎉 New Appointment with ${client_name}`,
    html: `
      <h1>A new appointment has been booked.</h1>
      <h3>Appointment Details:</h3>
      <ul>
        <li><strong>Client Name:</strong> ${client_name}</li>
        <li><strong>Client Email:</strong> ${client_email}</li>
        <li>
          <strong>Time (App Timezone - ${appDefaultTimezone}):</strong> ${appLocalTime}
        </li>
        <li>
          <strong>Time (Client Timezone - ${clientTimezone}):</strong> ${clientLocalTime}
        </li>
        <li><strong>Details:</strong> ${details || 'N/A'}</li>
      </ul>
    `,
  };

  try {
    // Send both emails
    const clientEmailPromise = transporter.sendMail(clientMailOptions);
    const adminEmailPromise = transporter.sendMail(adminMailOptions);

    await Promise.all([clientEmailPromise, adminEmailPromise]);
    console.log('Client confirmation and admin notification emails sent successfully.');
  } catch (error) {
    console.error('Error sending booking emails:', error);
  }
}


/**
 * Sends cancellation notification emails to the client and admin.
 * @param {object} appointmentDetails - The details of the cancelled appointment.
 * @param {string|null} customMessage - An optional custom message for the client.
 */
async function sendCancellationEmails(appointmentDetails, customMessage = null) {
  const { client_name, client_email, appointment_date, details } = appointmentDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;

  const dateTimeFormat = 'MMMM d, yyyy \'at\' p';
  const appLocalTime = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

  // --- NEW: Conditionally add the custom message ---
  let customMessageHtml = '';
  if (customMessage) {
    // Wrap the message in a paragraph for nice formatting.
    customMessageHtml = `<p style="padding: 10px; border-left: 3px solid #ccc; font-style: italic;">${customMessage}</p>`;
  }

  // 1. Email to the Client (with potential custom message)
  const clientMailOptions = {
    from: `"${appName}" <${process.env.EMAIL_USER}>`,
    to: client_email,
    subject: `❌ Your Appointment has been Cancelled`,
    html: `
      <h1>Hi ${client_name},</h1>
      <p>This is a confirmation that your appointment has been cancelled.</p>
      ${customMessageHtml} 
      <p>Here are the details of the cancelled meeting:</p>
      <ul>
        <li><strong>Date & Time:</strong> ${appLocalTime} (${appDefaultTimezone})</li>
        <li><strong>Details:</strong> ${details || 'N/A'}</li>
      </ul>
      <p>If you believe this was a mistake, please contact us to reschedule.</p>
    `,
  };

  // 2. Notification to the Admin (remains the same, no custom message)
  const adminMailOptions = {
    from: `"${appName} Notifier" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `❗️ Appointment Cancelled with ${client_name}`,
    html: `
      <h1>An appointment has been cancelled.</h1>
      <h3>Cancelled Appointment Details:</h3>
      <ul>
        <li><strong>Client Name:</strong> ${client_name}</li>
        <li><strong>Client Email:</strong> ${client_email}</li>
        <li><strong>Time (App Timezone):</strong> ${appLocalTime}</li>
      </ul>
    `,
  };

  try {
    await Promise.all([
        transporter.sendMail(clientMailOptions),
        transporter.sendMail(adminMailOptions)
    ]);
    console.log('Cancellation notification emails sent successfully.');
  } catch (error) {
    console.error('Error sending cancellation emails:', error);
  }
}

/**
 * Sends a single reminder email for an appointment.
 * @param {object} reminderDetails - An object containing both appointment and reminder info.
 */
async function sendReminderEmail(reminderDetails) {
  const { 
    client_name, 
    client_email, 
    appointment_date, 
    details,
    reminder_id,
    message // --- NEW: Get the message from the details object
  } = reminderDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;

  const dateTimeFormat = 'MMMM d, yyyy \'at\' p';
  const appLocalTime = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

  // --- NEW: Conditionally add the custom message ---
  let customMessageHtml = '';
  if (message) {
    customMessageHtml = `<p style="padding: 10px; border-left: 3px solid #ccc; font-style: italic;">${message}</p>`;
  }

  const mailOptions = {
    from: `"${appName}" <${process.env.EMAIL_USER}>`,
    to: client_email,
    subject: `⏰ Reminder: Your Appointment is Soon!`,
    html: `
      <h1>Hi ${client_name},</h1>
      <p>This is a friendly reminder about your upcoming appointment.</p>
      ${customMessageHtml}
      <h3>Appointment Details:</h3>
      <ul>
        <li><strong>Date & Time:</strong> ${appLocalTime} (${appDefaultTimezone})</li>
        <li><strong>Details:</strong> ${details || 'N/A'}</li>
      </ul>
      <p>We look forward to seeing you soon!</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Successfully sent reminder for appointment with ${client_name} (Reminder ID: ${reminder_id}).`);
    return true;
  } catch (error) {
    console.error(`Failed to send reminder ID ${reminder_id}:`, error);
    return false;
  }
}

/**
 * Sends a thank you email 24 hours after an appointment.
 * @param {object} thankYouDetails - An object containing appointment and message info.
 */
async function sendThankYouEmail(thankYouDetails) {
  const { 
    client_name, 
    client_email, 
    appointment_date, 
    message // The optional custom message
  } = thankYouDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;
  const dateTimeFormat = 'MMMM d, yyyy';
  const appLocalDate = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

  let customMessageHtml = '';
  if (message) {
    customMessageHtml = `<p style="padding: 10px; border-left: 3px solid #ccc; font-style: italic;">${message}</p>`;
  }

  const mailOptions = {
    from: `"${appName}" <${process.env.EMAIL_USER}>`,
    to: client_email,
    subject: `Thank you for our meeting!`,
    html: `
      <h1>Hi ${client_name},</h1>
      <p>Just a quick note to say thank you for your meeting with us on ${appLocalDate}.</p>
      ${customMessageHtml}
      <p>We appreciate your time and look forward to our next steps together.</p>
      <p>Best regards,<br/>The ${appName} Team</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Successfully sent thank you message for appointment with ${client_name}.`);
    return true;
  } catch (error) {
    console.error(`Failed to send thank you message for appointment with ${client_name}:`, error);
    return false;
  }
}


// Don't forget to export the new function
module.exports = { sendBookingEmails, sendCancellationEmails, sendReminderEmail, sendThankYouEmail };