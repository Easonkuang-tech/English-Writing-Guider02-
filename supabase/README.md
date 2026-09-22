# Supabase

Run migrations in filename order from the Supabase SQL editor or Supabase CLI.

The first migration creates multiuser tables and Row Level Security policies.
Every business row is owned by `auth.users.id` through `user_id`.

Required Railway variables:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_ORIGIN=
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
