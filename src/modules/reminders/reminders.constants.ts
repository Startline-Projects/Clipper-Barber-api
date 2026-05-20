// Barber-local wall-clock time MORNING_OF reminders fire at.
export const MORNING_OF_LOCAL_TIME = '09:00';

// Default grace window (minutes). If a reminder's send_at is already in the
// past at compute time, it's only kept (and sent immediately) when it's no
// more than this many minutes late; otherwise it's marked SKIPPED. Overridable
// via REMINDER_GRACE_MINUTES. Spec default: 0 (skip any past-due reminder).
export const DEFAULT_GRACE_MINUTES = 0;

// Resend send retries before a reminder is marked FAILED.
export const MAX_ATTEMPTS = 3;

// Max reminders claimed per cron tick.
export const DISPATCH_BATCH_LIMIT = 100;

// A row stuck in 'sending' longer than this (e.g. the process crashed mid-send)
// is reclaimed by the next cron tick.
export const STALE_SENDING_MINUTES = 10;

// Safety-net sweep horizon: how far ahead the cron reconciles bookings whose
// precompute handler may have been missed.
export const RECONCILE_WINDOW_DAYS = 30;
