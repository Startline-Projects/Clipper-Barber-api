# Database Setup

## 1. Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- A Supabase project created at [supabase.com](https://supabase.com)

## 2. Environment Variables

Add these to your `.env`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

Keys are found in: **Project Settings → API**

## 3. Run Migrations

Link your local project to the remote Supabase project:

```bash
supabase link --project-ref <project-ref>
```

Push all migrations to the remote database:

```bash
supabase db push
```

To reset and reapply from scratch (local dev only):

```bash
supabase db reset
```

---

## 4. Supabase Dashboard Settings (Manual Steps Required)

These cannot be applied via migration and must be configured manually in the Supabase dashboard.

### Realtime

Go to **Database → Replication** and enable the following tables for the `supabase_realtime` publication:

| Table                   | Reason                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `messages`              | Live chat messages within a thread (auto-added by migration)   |
| `conversations`         | Live chat list updates + unread counts (auto-added by migration) |
| `bookings`              | Barber sees new bookings instantly; client sees status updates |
| `recurring_occurrences` | Live status updates for recurring charge events                |

For each enabled table, make sure **Row Level Security** is toggled ON in the Replication settings so Realtime respects your RLS policies.

### Authentication

Go to **Authentication → Providers**:

- Enable **Email** provider
- Configure **"Confirm email"** based on your UX requirements (recommended: enabled for production)

Go to **Authentication → Settings**:

- Set **JWT expiry** to match your NestJS guard configuration (default: `3600` seconds)

### API Keys

Go to **Project Settings → API**:

- Copy the **Service Role key** → set as `SUPABASE_SERVICE_ROLE_KEY` in `.env`
  - This key bypasses RLS and is used for server-side operations (e.g., Stripe webhooks, admin actions)
  - Never expose it on the client

### Stripe Webhook Secret

Go to **Project Settings → Edge Functions → Secrets** (or use your server's environment config):

- Add `STRIPE_WEBHOOK_SECRET` — obtained from the Stripe dashboard when registering your webhook endpoint
