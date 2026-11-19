-- 05_seed.sql
-- Seed 7 skill categories, flagship skills across all 7 domains, courses, and sample opportunities (Idempotent)

insert into public.categories (slug, name, description, position)
values
  ('communication-interpersonal', 'Communication & Interpersonal', 'Clear workplace communication, public speaking, negotiation, active listening, leadership, and conflict resolution.', 1),
  ('writing-content-creation', 'Writing & Content Creation', 'Creative storytelling, business writing, copywriting, technical documentation, editing, and SEO content strategy.', 2),
  ('entrepreneurship-business', 'Entrepreneurship & Business', 'Startup fundamentals, business planning, market research, financial literacy, CRM, product and project management.', 3),
  ('digital-marketing-social', 'Digital Marketing & Social Media', 'Social media management, Meta and Google advertising, SEO, email marketing, analytics, and conversion optimization.', 4),
  ('creative-design', 'Creative & Design', 'Graphic design, Canva, UI/UX design, brand identity, photography, video editing, and art direction.', 5),
  ('technology-digital', 'Technology & Digital', 'Web and mobile development, databases, data analysis, cybersecurity, cloud computing, AI, testing, and DevOps.', 6),
  ('career-professional', 'Career & Professional Development', 'CV writing, interview readiness, freelancing, remote collaboration, time management, and client management.', 7)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  position = excluded.position;

insert into public.skills (slug, title, category_id, category, level, summary, competency_expectations, roadmap_status, publication_status, est_hours, outcomes)
select
  v.slug,
  v.title,
  c.id,
  c.name,
  v.level,
  v.summary,
  v.competency_expectations,
  'full',
  'published',
  v.est_hours,
  v.outcomes
from (
  values
    ('effective-communication', 'Effective Communication', 'communication-interpersonal', 'Beginner', 'Structure clear spoken and written messages tailored to colleagues, clients, and decision-makers.', 'Demonstrate clear framing, active listening, and stakeholder alignment.', 8.0, '["Frame messages clearly for busy audiences","Listen actively and confirm mutual understanding"]'::jsonb),
    ('public-speaking', 'Public Speaking', 'communication-interpersonal', 'Intermediate', 'Design persuasive talks, manage delivery pacing, and engage audiences with confidence.', 'Deliver structured 5-minute briefings with composed Q&A.', 12.0, '["Open with a clear problem-impact hook","Handle Q&A concisely using structured bridging"]'::jsonb),
    ('business-writing', 'Business Writing', 'writing-content-creation', 'Beginner', 'Use Bottom Line Up Front (BLUF) structure so busy readers grasp decisions fast.', 'Author concise executive briefs and owner-dated action logs.', 8.0, '["Lead with the recommendation upfront","Pair claims with baseline metrics and next owners"]'::jsonb),
    ('creative-writing', 'Creative Writing', 'writing-content-creation', 'Beginner', 'Craft vivid scenes, memorable characters, compelling dialogue, and cohesive narratives.', 'Complete multi-course fiction and revision pathways from foundations to publication.', 16.0, '["Write sensory-grounded narrative scenes","Control pacing, subtext, and line-level revision"]'::jsonb),
    ('entrepreneurship', 'Entrepreneurship', 'entrepreneurship-business', 'Beginner', 'Validate real customer pain, design viable business models, and launch lean ventures.', 'Validate riskiest assumptions and model sustainable unit economics.', 14.0, '["Run structured customer discovery interviews","Validate lean business models before scaling"]'::jsonb),
    ('social-media-management', 'Social Media Management', 'digital-marketing-social', 'Beginner', 'Plan 30-day content calendars, grow engaged communities, and report channel performance.', 'Manage content pillars, community engagement, and retention reporting.', 10.0, '["Build balanced 30-day content calendars","Report saves, shares, and retention metrics"]'::jsonb),
    ('facebook-and-instagram-advertising', 'Facebook and Instagram Advertising', 'digital-marketing-social', 'Intermediate', 'Plan, launch, retarget, and optimize Meta ad campaigns from beginner foundations to analytics.', 'Complete Beginner through Analytics & Optimization courses on Meta Ads Manager.', 20.0, '["Structure 3-tier Meta campaigns","Design retargeting funnels and diagnose ROAS/CPA"]'::jsonb),
    ('graphic-design', 'Graphic Design', 'creative-design', 'Beginner', 'Apply visual hierarchy, typography, grid alignment, and color contrast to real deliverables.', 'Deliver print and social assets grounded in typography and grid systems.', 10.0, '["Apply visual hierarchy and spacing grids","Pair accessible color palettes cleanly"]'::jsonb),
    ('web-development', 'Web Development', 'technology-digital', 'Beginner', 'Build semantic, accessible HTML/CSS layouts and modular interactive JavaScript web apps.', 'Ship responsive accessible interfaces with clean state management.', 18.0, '["Write semantic WCAG-friendly HTML/CSS","Build modular interactive browser workflows"]'::jsonb),
    ('data-analysis', 'Data Analysis', 'technology-digital', 'Beginner', 'Clean messy datasets, write analytical queries, and surface clear decision insights.', 'Separate vanity metrics from decision-grade baselines and cohorts.', 12.0, '["Clean and segment tabular datasets","Communicate KPI movements accurately"]'::jsonb),
    ('cv-and-resume-writing', 'CV and Resume Writing', 'career-professional', 'Beginner', 'Frame measurable achievements, clear formatting, and role-tailored summaries.', 'Produce ATS-scannable, impact-quantified CVs tailored to real listings.', 6.0, '["Quantify bullet impact with Action-Metric-Result","Tailor CVs without sacrificing factual clarity"]'::jsonb)
) as v(slug, title, cat_slug, level, summary, competency_expectations, est_hours, outcomes)
join public.categories c on c.slug = v.cat_slug
on conflict (slug) do update set
  category_id = excluded.category_id,
  category = excluded.category,
  competency_expectations = excluded.competency_expectations,
  publication_status = excluded.publication_status;

insert into public.opportunities (
  title,
  organization,
  opportunity_type,
  work_mode,
  location,
  summary,
  about_role,
  responsibilities,
  requirements,
  required_skills,
  required_skill_slugs,
  other_info,
  org_tips,
  is_sample,
  apply_url
)
values
  (
    'Paid Social & Meta Ads Coordinator',
    'Kestrel Consumer Studio',
    'Junior Role',
    'Hybrid',
    'London, UK',
    'Plan, build, and optimize Meta acquisition and retargeting campaigns while reporting weekly ROAS and creative fatigue diagnostics.',
    'Kestrel Consumer Studio manages growth campaigns for sustainable retail brands. As Paid Social & Meta Ads Coordinator, you will structure Meta ad accounts, draft multi-hook ad creatives, interpret pixel/CAPI signals, and present crisp optimization readouts.',
    '["Structure Campaign, Ad Set, and Ad tiers aligned with funnel conversion objectives.", "Monitor CTR, CPA, Frequency, and 7-day ROAS trends across active campaigns.", "Coordinate monthly social content calendars alongside brand designers.", "Draft weekly BLUF campaign performance memos for account leads."]'::jsonb,
    '["Verified or demonstrated fluency in Facebook and Instagram Advertising.", "Hands-on planning experience in Social Media Management.", "Clear written business communication for client reporting."]'::jsonb,
    '[{"slug": "facebook-and-instagram-advertising", "neededLevel": "practising"}, {"slug": "social-media-management", "neededLevel": "practising"}, {"slug": "business-writing", "neededLevel": "practising"}]'::jsonb,
    '["facebook-and-instagram-advertising", "social-media-management", "business-writing"]'::jsonb,
    '{"compensation": "£29,000 – £33,000 / year", "duration": "Full-time · Permanent", "schedule": "3 days studio (London), 2 days remote", "deadline": "Rolling cohort review"}'::jsonb,
    '{"aboutOrg": "Kestrel emphasizes transparent attribution, creative testing discipline, and clear client communication without vanity reporting.", "howToApply": "Include a campaign blueprint or creative test plan alongside your CV and highlight any completed Kord ad analytics projects.", "tips": ["Explain how you separate cold prospecting from warm retargeting audiences.", "Show how you diagnose high CPM vs. low landing-page conversion."]}'::jsonb,
    true,
    'https://example.org/opportunities/kestrel-meta-ads'
  ),
  (
    'Editorial & Creative Content Fellow',
    'Harbourline Storytelling Lab',
    'Fellowship',
    'Remote',
    'Remote (UK / EU)',
    'Craft compelling short fiction, brand essays, and narrative scripts while leading peer critique workshops.',
    'Harbourline Storytelling Lab publishes community-funded fiction anthologies and narrative audio documentaries. Fellows develop vivid scenes, sharpen dialogue subtext, and edit long-form manuscripts to publication standard.',
    '["Write and revise 1,500–2,500 word narrative pieces anchored in sensory scene work.", "Develop voice-consistent character dialogue and structural outlines.", "Collaborate with editorial leads during line-editing and copy-proofing passes."]'::jsonb,
    '["Practising or higher mastery in Creative Writing.", "Strong command of narrative pacing, dialogue clarity, and structural editing."]'::jsonb,
    '[{"slug": "creative-writing", "neededLevel": "practising"}, {"slug": "effective-communication", "neededLevel": "practising"}]'::jsonb,
    '["creative-writing", "effective-communication"]'::jsonb,
    '{"compensation": "£2,050 / month fellowship stipend", "duration": "6 months", "schedule": "Remote · Async editorial sprints + Tuesday table reads", "deadline": "Applications reviewed weekly"}'::jsonb,
    '{"aboutOrg": "Harbourline values original voice, disciplined revision habits, and generous peer critique.", "howToApply": "Submit a 600–1,200 word original scene or story draft demonstrating scene grounding and earned dialogue.", "tips": ["Lead immediately with action and specific sensory detail rather than backstory exposition.", "Highlight one concrete structural revision you made between draft 1 and draft 2."]}'::jsonb,
    true,
    'https://example.org/opportunities/harbourline-editorial'
  ),
  (
    'Venture Operations & Strategy Intern',
    'Northbridge Impact Ventures',
    'Internship',
    'Hybrid',
    'Manchester, UK',
    'Support early-stage founders with customer discovery synthesis, unit-economics modeling, and investor update memos.',
    'Northbridge Impact Ventures backs seed-stage civic and climate startups. As Venture Operations Intern, you will help founders map problem interviews, test MVP hypotheses, and communicate clear milestones.',
    '["Synthesize founder customer discovery notes into actionable opportunity memos.", "Audit startup unit economics, break-even assumptions, and launch milestones.", "Coordinate pitch rehearsal briefings with portfolio teams."]'::jsonb,
    '["Solid grounding in Entrepreneurship and lean validation workflows.", "Confident Effective Communication and concise Business Writing."]'::jsonb,
    '[{"slug": "entrepreneurship", "neededLevel": "practising"}, {"slug": "effective-communication", "neededLevel": "practising"}, {"slug": "business-writing", "neededLevel": "practising"}]'::jsonb,
    '["entrepreneurship", "effective-communication", "business-writing"]'::jsonb,
    '{"compensation": "£1,950 / month paid internship", "duration": "12 weeks (extendable)", "schedule": "2 days Manchester hub, 3 days remote", "deadline": "Closes in 21 days"}'::jsonb,
    '{"aboutOrg": "Northbridge prefers evidence of real customer conversations over polished slide templates.", "howToApply": "Attach a 1-page Venture Validation Canvas or startup brief alongside your tailored CV.", "tips": ["Name the riskiest assumption in any business model and how you would test it cheaply.", "Quantify customer pain with specific frequency or cost estimates."]}'::jsonb,
    true,
    'https://example.org/opportunities/northbridge-venture'
  ),
  (
    'Junior Web & Visual Systems Developer',
    'OpenCouncil Digital Studio',
    'Apprenticeship',
    'Remote',
    'Remote',
    'Build accessible, responsive web interfaces and visual communication assets for public-benefit web services.',
    'OpenCouncil Digital Studio creates accessible web portals and community tools. You will build semantic HTML/CSS layouts, accessible interactive JavaScript modules, and crisp visual graphics.',
    '["Implement responsive grid layouts with WCAG AA contrast and keyboard focus order.", "Build modular vanilla JavaScript components with clean DOM state handling.", "Create campaign flyers, info cards, and UI assets using consistent typographic hierarchy."]'::jsonb,
    '["Practising or higher skill level in Web Development.", "Working eye for visual hierarchy and layout in Graphic Design.", "Clear documentation and collaborative communication."]'::jsonb,
    '[{"slug": "web-development", "neededLevel": "practising"}, {"slug": "graphic-design", "neededLevel": "practising"}, {"slug": "effective-communication", "neededLevel": "declared"}]'::jsonb,
    '["web-development", "graphic-design", "effective-communication"]'::jsonb,
    '{"compensation": "£25,500 / year + hardware budget", "duration": "12-month apprenticeship", "schedule": "Full-time · Remote", "deadline": "Next intake open"}'::jsonb,
    '{"aboutOrg": "OpenCouncil prioritizes native browser standards, semantic HTML, and crisp design restraint over bloated frameworks.", "howToApply": "Share a link to a live semantic web page or accessible UI audit plus your tailored resume.", "tips": ["Test every interactive control using only Tab, Shift+Tab, and Enter before submitting.", "Explain your font-scale and contrast choices briefly."]}'::jsonb,
    true,
    'https://example.org/opportunities/opencouncil-web'
  )
on conflict (title, organization) do update set
  opportunity_type = excluded.opportunity_type,
  work_mode = excluded.work_mode,
  location = excluded.location,
  summary = excluded.summary,
  about_role = excluded.about_role,
  responsibilities = excluded.responsibilities,
  requirements = excluded.requirements,
  required_skills = excluded.required_skills,
  required_skill_slugs = excluded.required_skill_slugs,
  other_info = excluded.other_info,
  org_tips = excluded.org_tips,
  is_sample = excluded.is_sample,
  apply_url = excluded.apply_url;
