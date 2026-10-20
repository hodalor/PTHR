/**
 * Pay-as-you-go OTP delivery helpers.
 * Email: Resend (RESEND_API_KEY) or SMTP-less console fallback.
 * SMS: Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).
 *
 * Firebase Phone Auth is not used as the identity store — keep JWT + bcrypt.
 * Pair Twilio (or another SMS API) with a Firebase Blaze project if you prefer
 * that billing console; the OTP itself is generated and verified by this API.
 */

const OTP_TTL_SECONDS = Math.max(60, Number(process.env.PASSWORD_RESET_OTP_TTL_SECONDS) || 600);
const OTP_DEBUG_LOG = String(process.env.OTP_DEBUG_LOG || '').trim().toLowerCase() === 'true';
const APP_NAME = String(process.env.APP_NAME || 'PTHR').trim() || 'PTHR';

function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.indexOf('@');
  if (at <= 1) {
    return value ? '***' : '';
  }
  return `${value.slice(0, 1)}***${value.slice(at - 1)}`;
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) {
    return digits ? '***' : '';
  }
  return `***${digits.slice(-4)}`;
}

function normalizePhoneE164(phone) {
  const raw = String(phone || '').trim();
  if (!raw) {
    return '';
  }
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  if (hasPlus) {
    return `+${digits}`;
  }
  // Default country code for local numbers without + (override via env).
  const defaultCountryCode = String(process.env.OTP_DEFAULT_COUNTRY_CODE || '233').replace(/\D/g, '');
  if (digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 9) {
    return `+${defaultCountryCode}${digits.slice(1)}`;
  }
  return `+${defaultCountryCode}${digits}`;
}

async function sendEmailOtp({ to, otp, tenantId }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || process.env.OTP_FROM_EMAIL || '').trim();
  const subject = `${APP_NAME} password reset code`;
  const text = `Your ${APP_NAME} password reset code is ${otp}. It expires in ${Math.floor(OTP_TTL_SECONDS / 60)} minutes. Tenant: ${tenantId}. If you did not request this, ignore this email.`;

  if (!apiKey || !from) {
    if (OTP_DEBUG_LOG || process.env.NODE_ENV !== 'production') {
      console.info(`[otp-delivery] email fallback to=${maskEmail(to)} otp=${otp} tenant=${tenantId}`);
      return { ok: true, provider: 'console', channel: 'email' };
    }
    throw new Error('Email OTP is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email OTP provider failed (${response.status}): ${body.slice(0, 200)}`);
  }

  return { ok: true, provider: 'resend', channel: 'email' };
}

async function sendSmsOtp({ to, otp, tenantId }) {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = String(process.env.TWILIO_FROM_NUMBER || '').trim();
  const e164 = normalizePhoneE164(to);
  const body = `${APP_NAME} password reset code: ${otp}. Expires in ${Math.floor(OTP_TTL_SECONDS / 60)} min. Tenant ${tenantId}.`;

  if (!accountSid || !authToken || !from) {
    if (OTP_DEBUG_LOG || process.env.NODE_ENV !== 'production') {
      console.info(`[otp-delivery] sms fallback to=${maskPhone(e164 || to)} otp=${otp} tenant=${tenantId}`);
      return { ok: true, provider: 'console', channel: 'sms' };
    }
    throw new Error('SMS OTP is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.');
  }

  if (!e164) {
    throw new Error('A valid phone number is required for SMS OTP');
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const form = new URLSearchParams({
    To: e164,
    From: from,
    Body: body,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`SMS OTP provider failed (${response.status}): ${responseBody.slice(0, 200)}`);
  }

  return { ok: true, provider: 'twilio', channel: 'sms' };
}

module.exports = {
  OTP_TTL_SECONDS,
  maskEmail,
  maskPhone,
  normalizePhoneE164,
  sendEmailOtp,
  sendSmsOtp,
};
