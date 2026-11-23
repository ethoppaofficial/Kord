# Kord decisions

- Production builds require valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` variables and fail closed when absent. Local development only enables Demo Mode when `VITE_ALLOW_DEMO_MODE=true` is explicitly configured in `.env`.
- When Supabase variables are present, repositories use Supabase Auth, Postgres, Storage and RPCs. Page components do not change between modes.
- Public sign-up (`auth.users` insert -> `public.handle_new_user()`) unconditionally creates `'learner'` profiles with `account_status = 'active'`. Production administrators are provisioned exclusively via `public.admin_assign_profile_role(target_user_id, 'admin')` executed from a trusted `service_role` / `postgres` context (never via email triggers, shared passwords, or client-side flags).
- The visual direction is the Civic skills lab described in plan.md, using the requested blue token palette and an evidence-first information hierarchy.
- Seed resources use stable, well-known public learning sources. Any resource needing replacement is listed in CONTENT_TODO.md.
- The dashboard (`src/dashboard/`) renders one data shape in both modes. Demo mode builds it from browser state (`dashboardData.js`); with a real Supabase session it calls `get_dashboard()` from `supabase/06_dashboard.sql`. Time learned is an estimate from each activity's `est_minutes` unless `minutes_spent` is recorded.
- Demo mode stores `completedAt` per activity so weekly and hour-of-day charts have dates. "Fill with sample history" fills nine weeks of sample data for local development demonstrations.
