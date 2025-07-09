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

// MODIFIED: Accepts the specific admin's notification email
async function sendBookingEmails(appointmentDetails, clientTimezone, adminNotificationEmail) {
  const { id, client_name, client_email, appointment_date, details } = appointmentDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;
  const dateTimeFormat = 'MMMM d, yyyy \'at\' p';

  const clientLocalTime = formatInTimeZone(appointment_date, clientTimezone, dateTimeFormat);
  const appLocalTime = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

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

  const adminMailOptions = {
    from: `"${appName} Booker" <${process.env.EMAIL_USER}>`,
    to: adminNotificationEmail, // USE THE ADMIN'S SPECIFIC EMAIL
    subject: `🎉 New Appointment with ${client_name}`,
    html: `
      <h1>A new appointment has been booked.</h1>
      <h3>Appointment Details:</h3>
      <ul>
        <li><strong>Client Name:</strong> ${client_name}</li>
        <li><strong>Client Email:</strong> ${client_email}</li>
        <li><strong>Time (App Timezone - ${appDefaultTimezone}):</strong> ${appLocalTime}</li>
        <li><strong>Time (Client Timezone - ${clientTimezone}):</strong> ${clientLocalTime}</li>
        <li><strong>Details:</strong> ${details || 'N/A'}</li>
      </ul>
    `,
  };

  try {
    await Promise.all([
        transporter.sendMail(clientMailOptions), 
        transporter.sendMail(adminMailOptions)
    ]);
    console.log('Client confirmation and admin notification emails sent successfully.');
  } catch (error) {
    console.error('Error sending booking emails:', error);
  }
}

// MODIFIED: Accepts the specific admin's notification email
async function sendCancellationEmails(appointmentDetails, customMessage = null, adminNotificationEmail) {
  const { client_name, client_email, appointment_date, details } = appointmentDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;
  const dateTimeFormat = 'MMMM d, yyyy \'at\' p';
  const appLocalTime = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

  let customMessageHtml = '';
  if (customMessage) {
    customMessageHtml = `<p style="padding: 10px; border-left: 3px solid #ccc; font-style: italic;">${customMessage}</p>`;
  }

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

  const adminMailOptions = {
    from: `"${appName} Notifier" <${process.env.EMAIL_USER}>`,
    to: adminNotificationEmail, // USE THE ADMIN'S SPECIFIC EMAIL
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

// UNCHANGED: sendReminderEmail does not notify the admin, so no change needed.
async function sendReminderEmail(reminderDetails) {
  const { 
    client_name, 
    client_email, 
    appointment_date, 
    details,
    reminder_id,
    message
  } = reminderDetails;

  const appDefaultTimezone = process.env.DEFAULT_TIMEZONE;
  const appName = process.env.CLIENT_FACING_APP_NAME;
  const dateTimeFormat = 'MMMM d, yyyy \'at\' p';
  const appLocalTime = formatInTimeZone(appointment_date, appDefaultTimezone, dateTimeFormat);

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

// UNCHANGED: sendThankYouEmail does not notify the admin, so no change needed.
async function sendThankYouEmail(thankYouDetails) {
  const { 
    client_name, 
    client_email, 
    appointment_date, 
    message
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

module.exports = { sendBookingEmails, sendCancellationEmails, sendReminderEmail, sendThankYouEmail };