# Kord decisions

- The Preview uses a clearly labelled demo mode when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are absent. Demo data persists in localStorage so the complete learner/admin journey can be demonstrated without a live Supabase project.
- When Supabase variables are present, repositories use Supabase Auth, Postgres, Storage and RPCs. Page components do not change between modes.
- `ethoppaofficial@gmail.com` is the demo administrator identity and is also assigned the admin role by the Supabase profile trigger for new auth users with that email.
- The visual direction is the Civic skills lab described in plan.md, using the requested blue token palette and an evidence-first information hierarchy.
- Seed resources use stable, well-known public learning sources. Any resource needing replacement is listed in CONTENT_TODO.md.
- The dashboard (`src/dashboard/`) renders one data shape in both modes. Demo mode builds it from browser state (`dashboardData.js`); with a real Supabase session it calls `get_dashboard()` from `supabase/06_dashboard.sql`. Time learned is an estimate from each activity's `est_minutes` unless `minutes_spent` is recorded.
- Demo mode stores `completedAt` per activity so weekly and hour-of-day charts have dates. "Fill with sample history" fills nine weeks of sample data for demonstrations.
