// Reminder email rendering — HTML + plain-text fallback in one place.
//
// Times are always rendered in the barber's IANA timezone with the zone shown
// (e.g. "Wed, Jul 15, 2026, 2:00 PM EDT") so the recipient never has to guess.

export type ReminderRecipient = 'client' | 'barber';

export interface ReminderEmailData {
  recipientType: ReminderRecipient;
  scheduledAtUtc: string;
  timezone: string;
  barberName: string;
  clientName: string;
  shopName: string | null;
  address: string | null;
  serviceNames: string[];
  durationMinutes: number | null;
  priceUsd: number | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderReminderEmail(data: ReminderEmailData): RenderedEmail {
  const when = formatAppointmentInTz(data.scheduledAtUtc, data.timezone);
  const location = buildLocation(data.shopName, data.address);
  const services = data.serviceNames.length > 0 ? data.serviceNames.join(', ') : null;

  // The headline names the OTHER party: clients see the barber, the barber
  // sees the client.
  const counterparty = data.recipientType === 'client' ? data.barberName : data.clientName;
  const greetingName = data.recipientType === 'client' ? data.clientName : data.barberName;

  const subject =
    data.recipientType === 'client'
      ? `Reminder: your appointment with ${data.barberName}`
      : `Reminder: appointment with ${data.clientName}`;

  const lead =
    data.recipientType === 'client'
      ? `You have an appointment with ${counterparty}${location ? ` at ${location}` : ''}.`
      : `You have an appointment with ${counterparty}.`;

  const rows: Array<[string, string]> = [['When', when]];
  if (location) rows.push(['Where', location]);
  if (services) rows.push(['Service', services]);
  if (data.durationMinutes != null) rows.push(['Duration', `${data.durationMinutes} min`]);
  if (data.priceUsd != null) rows.push(['Price', formatPrice(data.priceUsd)]);

  return {
    subject,
    html: renderHtml(greetingName, lead, rows),
    text: renderText(greetingName, lead, rows),
  };
}

function renderHtml(greetingName: string, lead: string, rows: Array<[string, string]>): string {
  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="background:#111827;padding:20px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">Appointment reminder</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px;color:#111827;font-size:16px;">Hi ${escapeHtml(greetingName)},</p>
                <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.5;">${escapeHtml(lead)}</p>
                <table role="presentation" cellpadding="0" cellspacing="0">${rowsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated reminder. Please do not reply to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(greetingName: string, lead: string, rows: Array<[string, string]>): string {
  const lines = [
    `Hi ${greetingName},`,
    '',
    lead,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'This is an automated reminder. Please do not reply to this email.',
  ];
  return lines.join('\n');
}

// "Wed, Jul 15, 2026, 2:00 PM EDT" — date, time, and zone label, all in tz.
export function formatAppointmentInTz(scheduledAtUtc: string, timezone: string): string {
  const instant = new Date(scheduledAtUtc);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}

function buildLocation(shopName: string | null, address: string | null): string | null {
  const parts = [shopName, address].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

function formatPrice(priceUsd: number): string {
  return `$${priceUsd.toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
