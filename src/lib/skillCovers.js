import { escapeHtml, slugify } from './formatters.js';

/** @typedef {{ c1: string; c2: string; accent: string; accentSoft: string; secondary: string; label: string }} SkillCoverPalette */
/** @typedef {Partial<import('../types/kord.d.ts').Skill> & { category_id?: string; categoryName?: string; coverUrl?: string; thumbnailUrl?: string }} SkillCoverInput */

/** @type {Record<string, SkillCoverPalette>} */
const CATEGORY_PALETTES = {
  'cat-communication': {
    c1: '#0f172a',
    c2: '#1e3a5f',
    accent: '#fbbf24',
    accentSoft: '#fde68a',
    secondary: '#38bdf8',
    label: 'Communication & Interpersonal',
  },
  'cat-writing': {
    c1: '#1c1917',
    c2: '#431407',
    accent: '#fb923c',
    accentSoft: '#fed7aa',
    secondary: '#facc15',
    label: 'Writing & Content Creation',
  },
  'cat-business': {
    c1: '#0b132b',
    c2: '#1e3a8a',
    accent: '#60a5fa',
    accentSoft: '#bfdbfe',
    secondary: '#34d399',
    label: 'Entrepreneurship & Business',
  },
  'cat-marketing': {
    c1: '#042f2e',
    c2: '#0f766e',
    accent: '#34d399',
    accentSoft: '#a7f3d0',
    secondary: '#38bdf8',
    label: 'Digital Marketing & Social Media',
  },
  'cat-creative': {
    c1: '#2e1065',
    c2: '#831843',
    accent: '#f472b6',
    accentSoft: '#fbcfe8',
    secondary: '#c084fc',
    label: 'Creative & Design',
  },
  'cat-tech': {
    c1: '#020617',
    c2: '#172554',
    accent: '#38bdf8',
    accentSoft: '#bae6fd',
    secondary: '#818cf8',
    label: 'Technology & Digital',
  },
  'cat-career': {
    c1: '#0f172a',
    c2: '#14532d',
    accent: '#4ade80',
    accentSoft: '#bbf7d0',
    secondary: '#fbbf24',
    label: 'Career & Professional Development',
  },
};

/** @type {Record<string, { cat: string; scene: string }>} */
const SLUG_SCENE_CONFIG = {
  // 1. Communication & Interpersonal (14)
  'effective-communication': { cat: 'cat-communication', scene: 'dialogue_clarity' },
  'public-speaking': { cat: 'cat-communication', scene: 'stage_podium' },
  'business-communication': { cat: 'cat-communication', scene: 'exec_memo' },
  'professional-communication': { cat: 'cat-communication', scene: 'channel_threads' },
  'negotiation-skills': { cat: 'cat-communication', scene: 'balance_scales' },
  'persuasion-and-influence': { cat: 'cat-communication', scene: 'focal_pillars' },
  'active-listening': { cat: 'cat-communication', scene: 'listening_waves' },
  'conflict-resolution': { cat: 'cat-communication', scene: 'bridge_alignment' },
  'emotional-intelligence': { cat: 'cat-communication', scene: 'empathy_rings' },
  'leadership-and-teamwork': { cat: 'cat-communication', scene: 'team_constellation' },
  'critical-thinking': { cat: 'cat-communication', scene: 'logic_lens' },
  'problem-solving': { cat: 'cat-communication', scene: 'root_tree' },
  'presentation-skills': { cat: 'cat-communication', scene: 'slide_deck' },
  'networking-and-relationship-building': { cat: 'cat-communication', scene: 'network_graph' },

  // 2. Writing & Content Creation (15)
  'general-writing': { cat: 'cat-writing', scene: 'nib_manuscript' },
  'professional-writing': { cat: 'cat-writing', scene: 'proposal_folio' },
  'business-writing': { cat: 'cat-writing', scene: 'bluf_pyramid' },
  'creative-writing': { cat: 'cat-writing', scene: 'open_storybook' },
  'storytelling': { cat: 'cat-writing', scene: 'narrative_arc' },
  'copywriting': { cat: 'cat-writing', scene: 'landing_copy' },
  'technical-writing': { cat: 'cat-writing', scene: 'api_docs' },
  'academic-writing': { cat: 'cat-writing', scene: 'citation_paper' },
  'report-writing': { cat: 'cat-writing', scene: 'analytics_report' },
  'email-writing': { cat: 'cat-writing', scene: 'email_composer' },
  'blogging': { cat: 'cat-writing', scene: 'editorial_blog' },
  'scriptwriting': { cat: 'cat-writing', scene: 'script_clapboard' },
  'content-strategy': { cat: 'cat-writing', scene: 'editorial_calendar' },
  'editing-and-proofreading': { cat: 'cat-writing', scene: 'redline_proof' },
  'seo-writing': { cat: 'cat-writing', scene: 'search_snippet' },

  // 3. Entrepreneurship & Business (15)
  'entrepreneurship': { cat: 'cat-business', scene: 'venture_launch' },
  'business-development': { cat: 'cat-business', scene: 'partnership_bridge' },
  'business-planning': { cat: 'cat-business', scene: 'milestone_roadmap' },
  'startup-fundamentals': { cat: 'cat-business', scene: 'mvp_discovery' },
  'business-model-development': { cat: 'cat-business', scene: 'bmc_canvas' },
  'market-research': { cat: 'cat-business', scene: 'market_radar' },
  'financial-literacy': { cat: 'cat-business', scene: 'cashflow_ledger' },
  'small-business-management': { cat: 'cat-business', scene: 'ops_dashboard' },
  'sales-fundamentals': { cat: 'cat-business', scene: 'sales_funnel' },
  'customer-relationship-management': { cat: 'cat-business', scene: 'crm_lifecycle' },
  'branding': { cat: 'cat-business', scene: 'brand_system' },
  'product-management': { cat: 'cat-business', scene: 'product_backlog' },
  'project-management': { cat: 'cat-business', scene: 'kanban_gantt' },
  'strategic-thinking': { cat: 'cat-business', scene: 'strategy_board' },
  'business-negotiation': { cat: 'cat-business', scene: 'contract_terms' },

  // 4. Digital Marketing & Social Media (17)
  'digital-marketing-fundamentals': { cat: 'cat-marketing', scene: 'growth_funnel' },
  'social-media-management': { cat: 'cat-marketing', scene: 'social_grid' },
  'facebook-page-management': { cat: 'cat-marketing', scene: 'page_storefront' },
  'facebook-and-instagram-advertising': { cat: 'cat-marketing', scene: 'meta_ad_cards' },
  'meta-ads-campaign-management': { cat: 'cat-marketing', scene: 'campaign_tree' },
  'google-ads': { cat: 'cat-marketing', scene: 'search_ads' },
  'search-engine-optimization': { cat: 'cat-marketing', scene: 'seo_crawler' },
  'search-engine-marketing': { cat: 'cat-marketing', scene: 'sem_split' },
  'email-marketing': { cat: 'cat-marketing', scene: 'drip_sequence' },
  'influencer-marketing': { cat: 'cat-marketing', scene: 'creator_collab' },
  'content-marketing': { cat: 'cat-marketing', scene: 'content_flywheel' },
  'marketing-analytics': { cat: 'cat-marketing', scene: 'utm_dashboard' },
  'community-management': { cat: 'cat-marketing', scene: 'community_hub' },
  'lead-generation': { cat: 'cat-marketing', scene: 'lead_capture' },
  'conversion-rate-optimization': { cat: 'cat-marketing', scene: 'ab_split_test' },
  'marketing-strategy': { cat: 'cat-marketing', scene: 'channel_mix' },
  'personal-branding': { cat: 'cat-marketing', scene: 'spotlight_card' },

  // 5. Creative & Design (10)
  'graphic-design': { cat: 'cat-creative', scene: 'poster_artboard' },
  'canva-design': { cat: 'cat-creative', scene: 'template_frames' },
  'ui-ux-design': { cat: 'cat-creative', scene: 'wireframe_flows' },
  'visual-communication': { cat: 'cat-creative', scene: 'infographic_nodes' },
  'photography': { cat: 'cat-creative', scene: 'camera_aperture' },
  'video-editing': { cat: 'cat-creative', scene: 'nle_timeline' },
  'motion-graphics': { cat: 'cat-creative', scene: 'bezier_keyframes' },
  'brand-identity-design': { cat: 'cat-creative', scene: 'logo_grid' },
  'creative-thinking': { cat: 'cat-creative', scene: 'ideation_diamond' },
  'art-direction': { cat: 'cat-creative', scene: 'moodboard_collage' },

  // 6. Technology & Digital (16)
  'web-development': { cat: 'cat-tech', scene: 'html_box_model' },
  'frontend-development': { cat: 'cat-tech', scene: 'code_browser_ui' },
  'backend-development': { cat: 'cat-tech', scene: 'api_endpoints' },
  'full-stack-development': { cat: 'cat-tech', scene: 'three_tier_stack' },
  'mobile-app-development': { cat: 'cat-tech', scene: 'mobile_screens' },
  'database-management': { cat: 'cat-tech', scene: 'erd_tables' },
  'cybersecurity': { cat: 'cat-tech', scene: 'security_shield' },
  'data-analysis': { cat: 'cat-tech', scene: 'data_charts' },
  'artificial-intelligence': { cat: 'cat-tech', scene: 'ai_pipeline' },
  'machine-learning': { cat: 'cat-tech', scene: 'ml_boundary' },
  'cloud-computing': { cat: 'cat-tech', scene: 'cloud_nodes' },
  'software-testing': { cat: 'cat-tech', scene: 'test_assertions' },
  'version-control': { cat: 'cat-tech', scene: 'git_branches' },
  'devops': { cat: 'cat-tech', scene: 'cicd_loop' },
  'technical-support': { cat: 'cat-tech', scene: 'ticket_triage' },
  'digital-productivity-tools': { cat: 'cat-tech', scene: 'workspace_suite' },

  // 7. Career & Professional Development (12)
  'cv-and-resume-writing': { cat: 'cat-career', scene: 'resume_sheet' },
  'interview-preparation': { cat: 'cat-career', scene: 'star_interview' },
  'career-development': { cat: 'cat-career', scene: 'career_ladder' },
  'freelancing': { cat: 'cat-career', scene: 'freelance_scope' },
  'remote-work-skills': { cat: 'cat-career', scene: 'remote_timezones' },
  'workplace-professionalism': { cat: 'cat-career', scene: 'reliability_badge' },
  'time-management': { cat: 'cat-career', scene: 'time_blocks' },
  'productivity': { cat: 'cat-career', scene: 'focus_streaks' },
  'personal-finance': { cat: 'cat-career', scene: 'budget_rings' },
  'professional-networking': { cat: 'cat-career', scene: 'mentor_bridge' },
  'portfolio-development': { cat: 'cat-career', scene: 'case_study_grid' },
  'client-management': { cat: 'cat-career', scene: 'client_milestones' },
};

/** @param {SkillCoverInput | null | undefined} skill */
function inferCategoryId(skill) {
  const rawCatId = String(skill?.categoryId || skill?.category_id || '').trim();
  if (rawCatId && CATEGORY_PALETTES[rawCatId]) return rawCatId;

  const text = `${skill?.category || ''} ${skill?.categoryName || ''} ${skill?.title || ''} ${skill?.slug || ''}`.toLowerCase();
  if (/writing|copy|blog|script|proofread|story|editorial/.test(text)) return 'cat-writing';
  if (/market|ads|social|seo|sem|influencer|community|lead|conversion|analytics & measurement/.test(text)) return 'cat-marketing';
  if (/design|ui\/ux|photo|video|motion|art|canva|visual/.test(text)) return 'cat-creative';
  if (/tech|web|frontend|backend|stack|mobile|database|cyber|data|ai|machine|cloud|test|git|devops|support|accessibility|product & web/.test(text)) return 'cat-tech';
  if (/business|startup|entrepreneur|finance|sales|crm|product|project|strateg/.test(text)) return 'cat-business';
  if (/career|cv|resume|interview|freelanc|remote|workplace|time|productivity|portfolio|client/.test(text)) return 'cat-career';
  return 'cat-communication';
}

/**
 * @param {SkillCoverInput | null | undefined} skill
 * @param {string} catId
 */
function inferSceneForUnknownSkill(skill, catId) {
  const s = `${skill?.slug || ''} ${skill?.title || ''}`.toLowerCase();
  if (/speak|present|talk/.test(s)) return 'stage_podium';
  if (/accessibility|web|html|css/.test(s)) return 'html_box_model';
  if (/analytics|measurement|data|metric/.test(s)) return 'data_charts';
  if (/business|memo|bluf|report/.test(s)) return 'bluf_pyramid';
  if (/design|ui|ux|brand/.test(s)) return 'wireframe_flows';
  if (/code|dev|software|api/.test(s)) return 'code_browser_ui';
  if (/market|ads|growth/.test(s)) return 'growth_funnel';
  if (/resume|cv|career|interview/.test(s)) return 'resume_sheet';

  /** @type {Record<string, string>} */
  const defaults = {
    'cat-communication': 'dialogue_clarity',
    'cat-writing': 'nib_manuscript',
    'cat-business': 'bmc_canvas',
    'cat-marketing': 'growth_funnel',
    'cat-creative': 'poster_artboard',
    'cat-tech': 'code_browser_ui',
    'cat-career': 'career_ladder',
  };
  return defaults[catId] || 'dialogue_clarity';
}

/** @param {SkillCoverInput | null | undefined} skill */
export function resolveSkillCoverSpec(skill) {
  const slug = slugify(skill?.slug || skill?.title || '');
  const mapped = SLUG_SCENE_CONFIG[slug];
  const catId = mapped?.cat || inferCategoryId(skill);
  const palette = CATEGORY_PALETTES[catId] || CATEGORY_PALETTES['cat-business'];
  const scene = mapped?.scene || inferSceneForUnknownSkill(skill, catId);
  return { slug, catId, palette, scene };
}

/**
 * @param {string} scene
 * @param {SkillCoverPalette} p
 */
function renderSceneArtwork(scene, p) {
  const a = p.accent;
  const s = p.secondary;
  const soft = p.accentSoft;

  switch (scene) {
    case 'dialogue_clarity':
      return `
        <rect x="118" y="54" width="230" height="96" rx="16" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-width="2"/>
        <path d="M150 150l-16 26 38-26" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-width="2" stroke-linejoin="round"/>
        <line x1="146" y1="88" x2="312" y2="88" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <line x1="146" y1="112" x2="274" y2="112" stroke="${soft}" stroke-width="4" stroke-linecap="round" opacity="0.75"/>
        <rect x="292" y="128" width="232" height="96" rx="16" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2"/>
        <path d="M476 224l18 24-40-24" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="332" cy="176" r="16" fill="${a}" fill-opacity="0.28" stroke="${a}" stroke-width="2"/>
        <path d="M325 176l5 5 10-10" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="364" y1="166" x2="494" y2="166" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <line x1="364" y1="188" x2="462" y2="188" stroke="${soft}" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`;

    case 'stage_podium':
      return `
        <circle cx="220" cy="76" r="22" fill="${a}" fill-opacity="0.9"/>
        <path d="M180 142c0-22 18-36 40-36s40 14 40 36" fill="${soft}" fill-opacity="0.35" stroke="${soft}" stroke-width="2"/>
        <rect x="164" y="142" width="112" height="92" rx="10" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2"/>
        <line x1="220" y1="114" x2="220" y2="142" stroke="${a}" stroke-width="3"/>
        <path d="M294 64c24 18 24 54 0 72" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
        <path d="M318 46c36 28 36 80 0 108" fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
        <path d="M342 30c46 38 46 102 0 140" fill="none" stroke="${soft}" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
        <g fill="#ffffff" fill-opacity="0.22" stroke="#ffffff" stroke-opacity="0.45" stroke-width="1.5">
          <circle cx="386" cy="196" r="14"/><circle cx="432" cy="186" r="14"/><circle cx="478" cy="196" r="14"/>
          <circle cx="408" cy="230" r="16"/><circle cx="456" cy="230" r="16"/><circle cx="504" cy="230" r="16"/>
        </g>`;

    case 'exec_memo':
      return `
        <rect x="172" y="34" width="296" height="212" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
        <rect x="196" y="56" width="128" height="22" rx="6" fill="${a}" fill-opacity="0.88"/>
        <rect x="342" y="56" width="102" height="22" rx="6" fill="${s}" fill-opacity="0.3" stroke="${s}" stroke-width="1.5"/>
        <line x1="196" y1="102" x2="444" y2="102" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1.5"/>
        <rect x="196" y="120" width="248" height="44" rx="8" fill="${a}" fill-opacity="0.14" stroke="${a}" stroke-width="1.5"/>
        <line x1="212" y1="136" x2="404" y2="136" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="212" y1="152" x2="348" y2="152" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="196" y1="188" x2="430" y2="188" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>
        <line x1="196" y1="208" x2="390" y2="208" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>`;

    case 'channel_threads':
      return `
        <rect x="128" y="42" width="256" height="62" rx="12" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1.5"/>
        <circle cx="160" cy="73" r="15" fill="${a}"/><line x1="188" y1="66" x2="346" y2="66" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="188" y1="82" x2="290" y2="82" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <rect x="256" y="116" width="256" height="62" rx="12" fill="${s}" fill-opacity="0.16" stroke="${s}" stroke-width="1.5"/>
        <circle cx="288" cy="147" r="15" fill="${s}"/><line x1="316" y1="140" x2="478" y2="140" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="316" y1="156" x2="424" y2="156" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <rect x="164" y="190" width="280" height="54" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="${a}" stroke-width="1.5"/>
        <circle cx="194" cy="217" r="12" fill="#4ade80"/><line x1="220" y1="217" x2="398" y2="217" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>`;

    case 'balance_scales':
      return `
        <line x1="320" y1="48" x2="320" y2="226" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="256" y1="226" x2="384" y2="226" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <line x1="176" y1="88" x2="464" y2="70" stroke="${a}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="320" cy="79" r="10" fill="${a}"/>
        <path d="M176 88l-38 78h76z" fill="none" stroke="${soft}" stroke-width="2"/>
        <path d="M134 166c0 16 84 16 84 0z" fill="${s}" fill-opacity="0.45" stroke="${s}" stroke-width="2"/>
        <path d="M464 70l-38 78h76z" fill="none" stroke="${soft}" stroke-width="2"/>
        <path d="M422 148c0 16 84 16 84 0z" fill="${a}" fill-opacity="0.55" stroke="${a}" stroke-width="2"/>`;

    case 'focal_pillars':
      return `
        <rect x="136" y="148" width="84" height="92" rx="10" fill="#ffffff" fill-opacity="0.1" stroke="${soft}" stroke-width="1.5"/>
        <rect x="278" y="114" width="84" height="126" rx="10" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-width="2"/>
        <rect x="420" y="148" width="84" height="92" rx="10" fill="#ffffff" fill-opacity="0.1" stroke="${soft}" stroke-width="1.5"/>
        <path d="M178 148L320 54l142 94" fill="none" stroke="${s}" stroke-width="2.5" stroke-dasharray="6 5"/>
        <circle cx="320" cy="54" r="18" fill="${a}"/>
        <path d="M312 54l6 6 11-12" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

    case 'listening_waves':
      return `
        <circle cx="240" cy="140" r="68" fill="${a}" fill-opacity="0.12" stroke="${a}" stroke-width="2"/>
        <circle cx="240" cy="140" r="42" fill="${a}" fill-opacity="0.2" stroke="${soft}" stroke-width="2"/>
        <circle cx="240" cy="140" r="16" fill="${a}"/>
        <path d="M342 96c26 24 26 64 0 88" fill="none" stroke="${s}" stroke-width="4" stroke-linecap="round"/>
        <path d="M378 72c38 38 38 98 0 136" fill="none" stroke="${soft}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
        <path d="M416 48c52 52 52 132 0 184" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.45"/>`;

    case 'bridge_alignment':
      return `
        <path d="M110 88c70 0 90 52 180 52" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/>
        <path d="M110 192c70 0 90-52 180-52" fill="none" stroke="${s}" stroke-width="4" stroke-linecap="round"/>
        <rect x="286" y="112" width="68" height="56" rx="14" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-width="2"/>
        <path d="M354 140h170" stroke="#4ade80" stroke-width="5" stroke-linecap="round"/>
        <path d="M504 124l22 16-22 16" fill="none" stroke="#4ade80" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;

    case 'empathy_rings':
      return `
        <circle cx="280" cy="140" r="74" fill="${a}" fill-opacity="0.14" stroke="${a}" stroke-width="2.5"/>
        <circle cx="360" cy="140" r="74" fill="${s}" fill-opacity="0.14" stroke="${s}" stroke-width="2.5"/>
        <circle cx="320" cy="140" r="24" fill="#ffffff" fill-opacity="0.9"/>
        <circle cx="320" cy="140" r="10" fill="${a}"/>`;

    case 'team_constellation':
      return `
        <g stroke="${soft}" stroke-opacity="0.5" stroke-width="2">
          <line x1="320" y1="140" x2="184" y2="82"/><line x1="320" y1="140" x2="456" y2="82"/>
          <line x1="320" y1="140" x2="176" y2="202"/><line x1="320" y1="140" x2="464" y2="202"/>
          <line x1="184" y1="82" x2="456" y2="82"/><line x1="176" y1="202" x2="464" y2="202"/>
        </g>
        <circle cx="320" cy="140" r="28" fill="${a}" stroke="#ffffff" stroke-width="3"/>
        <circle cx="184" cy="82" r="20" fill="${s}"/><circle cx="456" cy="82" r="20" fill="${s}"/>
        <circle cx="176" cy="202" r="20" fill="${soft}"/><circle cx="464" cy="202" r="20" fill="${soft}"/>`;

    case 'logic_lens':
      return `
        <rect x="136" y="74" width="110" height="44" rx="8" fill="#ffffff" fill-opacity="0.1" stroke="${soft}" stroke-width="1.5"/>
        <rect x="136" y="162" width="110" height="44" rx="8" fill="#ffffff" fill-opacity="0.1" stroke="${soft}" stroke-width="1.5"/>
        <line x1="246" y1="96" x2="310" y2="132" stroke="${a}" stroke-width="2.5"/>
        <line x1="246" y1="184" x2="310" y2="148" stroke="${a}" stroke-width="2.5"/>
        <circle cx="352" cy="140" r="46" fill="${s}" fill-opacity="0.16" stroke="${a}" stroke-width="3.5"/>
        <line x1="386" y1="174" x2="432" y2="220" stroke="${a}" stroke-width="7" stroke-linecap="round"/>
        <rect x="434" y="114" width="96" height="52" rx="10" fill="#4ade80" fill-opacity="0.2" stroke="#4ade80" stroke-width="2"/>
        <path d="M468 140l10 10 18-20" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

    case 'root_tree':
      return `
        <rect x="122" y="114" width="92" height="52" rx="10" fill="${a}" fill-opacity="0.24" stroke="${a}" stroke-width="2"/>
        <path d="M214 140h54M268 72v136M268 72h56M268 140h56M268 208h56" fill="none" stroke="${soft}" stroke-width="2.5"/>
        <rect x="324" y="50" width="96" height="44" rx="8" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.35"/>
        <rect x="324" y="118" width="96" height="44" rx="8" fill="#4ade80" fill-opacity="0.22" stroke="#4ade80" stroke-width="2"/>
        <rect x="324" y="186" width="96" height="44" rx="8" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.35"/>
        <line x1="420" y1="140" x2="472" y2="140" stroke="#4ade80" stroke-width="3"/>
        <circle cx="494" cy="140" r="22" fill="#4ade80"/>
        <path d="M485 140l6 6 13-13" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>`;

    case 'slide_deck':
      return `
        <rect x="148" y="46" width="344" height="186" rx="14" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <rect x="174" y="72" width="160" height="16" rx="4" fill="${a}"/>
        <rect x="174" y="108" width="128" height="96" rx="8" fill="#ffffff" fill-opacity="0.08" stroke="${soft}" stroke-opacity="0.4"/>
        <line x1="190" y1="132" x2="282" y2="132" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="190" y1="154" x2="262" y2="154" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="190" y1="176" x2="274" y2="176" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <rect x="322" y="108" width="144" height="96" rx="8" fill="${s}" fill-opacity="0.16" stroke="${s}" stroke-width="1.5"/>
        <rect x="344" y="156" width="20" height="34" rx="3" fill="${s}"/>
        <rect x="378" y="138" width="20" height="52" rx="3" fill="${a}"/>
        <rect x="412" y="122" width="20" height="68" rx="3" fill="#ffffff"/>`;

    case 'network_graph':
      return `
        <g stroke="${soft}" stroke-opacity="0.45" stroke-width="2">
          <line x1="180" y1="140" x2="280" y2="76"/><line x1="180" y1="140" x2="296" y2="204"/>
          <line x1="280" y1="76" x2="416" y2="96"/><line x1="296" y1="204" x2="416" y2="96"/>
          <line x1="296" y1="204" x2="472" y2="188"/><line x1="416" y1="96" x2="472" y2="188"/>
        </g>
        <circle cx="180" cy="140" r="22" fill="${a}"/><circle cx="280" cy="76" r="18" fill="${s}"/>
        <circle cx="296" cy="204" r="18" fill="${soft}"/><circle cx="416" cy="96" r="24" fill="${a}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="472" cy="188" r="16" fill="${s}"/>`;

    // Writing & Content Creation
    case 'nib_manuscript':
      return `
        <rect x="174" y="34" width="232" height="212" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <line x1="204" y1="76" x2="366" y2="76" stroke="${a}" stroke-width="6" stroke-linecap="round"/>
        <line x1="204" y1="108" x2="376" y2="108" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4" stroke-linecap="round"/>
        <line x1="204" y1="134" x2="352" y2="134" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>
        <line x1="204" y1="160" x2="368" y2="160" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>
        <line x1="204" y1="186" x2="312" y2="186" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>
        <path d="M442 62l34 34-68 68-42 8 8-42z" fill="${a}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
        <line x1="366" y1="172" x2="412" y2="126" stroke="#1c1917" stroke-width="2.5"/>`;

    case 'proposal_folio':
      return `
        <rect x="190" y="38" width="260" height="204" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-opacity="0.4" stroke-width="2"/>
        <rect x="190" y="38" width="64" height="204" rx="12" fill="${a}" fill-opacity="0.22"/>
        <rect x="278" y="68" width="144" height="16" rx="4" fill="#ffffff"/>
        <line x1="278" y1="106" x2="422" y2="106" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="278" y1="128" x2="404" y2="128" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="278" y1="150" x2="416" y2="150" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M278 198c16-14 28 12 44-4 14-14 26 8 42-2" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>`;

    case 'bluf_pyramid':
      return `
        <polygon points="320,40 460,236 180,236" fill="${a}" fill-opacity="0.14" stroke="${a}" stroke-width="2.5" stroke-linejoin="round"/>
        <polygon points="320,40 374,116 266,116" fill="${a}" fill-opacity="0.72"/>
        <line x1="230" y1="166" x2="410" y2="166" stroke="${soft}" stroke-width="2"/>
        <line x1="204" y1="202" x2="436" y2="202" stroke="${soft}" stroke-width="2"/>
        <line x1="302" y1="90" x2="338" y2="90" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>`;

    case 'open_storybook':
      return `
        <path d="M134 62c68-14 136 0 186 24 50-24 118-38 186-24v154c-68-14-136 0-186 24-50-24-118-38-186-24z" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>
        <line x1="320" y1="86" x2="320" y2="240" stroke="${a}" stroke-width="2.5"/>
        <line x1="166" y1="106" x2="288" y2="112" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="166" y1="132" x2="276" y2="138" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round"/>
        <line x1="166" y1="158" x2="284" y2="164" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round"/>
        <circle cx="414" cy="142" r="34" fill="${a}" fill-opacity="0.24" stroke="${a}" stroke-width="2"/>
        <path d="M398 152c14-24 22-28 34-10" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`;

    case 'narrative_arc':
      return `
        <line x1="120" y1="216" x2="520" y2="216" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <path d="M132 206c58-4 86-56 122-96 34-38 56-68 78-68 28 0 46 68 78 112 24 32 54 44 96 46" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="152" cy="204" r="8" fill="${soft}"/><circle cx="332" cy="42" r="11" fill="${s}" stroke="#ffffff" stroke-width="2.5"/><circle cx="496" cy="200" r="8" fill="#4ade80"/>`;

    case 'landing_copy':
      return `
        <rect x="148" y="40" width="344" height="200" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="182" y="70" width="210" height="20" rx="5" fill="#ffffff"/>
        <rect x="182" y="102" width="268" height="10" rx="4" fill="${soft}" fill-opacity="0.7"/>
        <rect x="182" y="122" width="224" height="10" rx="4" fill="${soft}" fill-opacity="0.45"/>
        <rect x="182" y="156" width="136" height="40" rx="8" fill="${a}"/>
        <line x1="212" y1="176" x2="288" y2="176" stroke="#1c1917" stroke-width="4" stroke-linecap="round"/>`;

    case 'api_docs':
      return `
        <rect x="134" y="42" width="372" height="196" rx="12" fill="#0f172a" stroke="${a}" stroke-opacity="0.65" stroke-width="2"/>
        <rect x="156" y="64" width="54" height="24" rx="6" fill="#4ade80" fill-opacity="0.24" stroke="#4ade80" stroke-width="1.5"/>
        <line x1="226" y1="76" x2="402" y2="76" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <rect x="156" y="106" width="328" height="108" rx="8" fill="#ffffff" fill-opacity="0.05"/>
        <line x1="176" y1="130" x2="310" y2="130" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="196" y1="156" x2="430" y2="156" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="196" y1="182" x2="380" y2="182" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>`;

    case 'citation_paper':
      return `
        <rect x="184" y="34" width="272" height="212" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <rect x="212" y="60" width="216" height="16" rx="4" fill="#ffffff"/>
        <line x1="212" y1="98" x2="310" y2="98" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="328" y1="98" x2="426" y2="98" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="212" y1="122" x2="310" y2="122" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round"/>
        <line x1="328" y1="122" x2="426" y2="122" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round"/>
        <rect x="212" y="156" width="216" height="58" rx="8" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="1.5"/>
        <line x1="228" y1="176" x2="394" y2="176" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="228" y1="196" x2="352" y2="196" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>`;

    case 'analytics_report':
      return `
        <rect x="156" y="38" width="328" height="204" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.32" stroke-width="2"/>
        <rect x="184" y="64" width="128" height="14" rx="4" fill="#ffffff"/>
        <rect x="184" y="96" width="144" height="114" rx="8" fill="#ffffff" fill-opacity="0.06" stroke="${soft}" stroke-opacity="0.35"/>
        <rect x="204" y="156" width="22" height="38" rx="3" fill="${soft}"/><rect x="238" y="132" width="22" height="62" rx="3" fill="${a}"/><rect x="272" y="114" width="22" height="80" rx="3" fill="#4ade80"/>
        <line x1="350" y1="106" x2="454" y2="106" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="350" y1="132" x2="438" y2="132" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="350" y1="158" x2="446" y2="158" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3" stroke-linecap="round"/>
        <line x1="350" y1="184" x2="416" y2="184" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3" stroke-linecap="round"/>`;

    case 'email_composer':
      return `
        <rect x="148" y="44" width="344" height="192" rx="14" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <line x1="148" y1="86" x2="492" y2="86" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1.5"/>
        <rect x="176" y="58" width="144" height="14" rx="4" fill="${soft}" fill-opacity="0.7"/>
        <line x1="176" y1="116" x2="436" y2="116" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="176" y1="142" x2="394" y2="142" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="176" y1="168" x2="352" y2="168" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="382" y="184" width="88" height="34" rx="8" fill="${a}"/>
        <path d="M416 201l22-8-8 22-4-10z" fill="#1c1917"/>`;

    case 'editorial_blog':
      return `
        <rect x="164" y="34" width="312" height="212" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="188" y="56" width="264" height="68" rx="8" fill="${a}" fill-opacity="0.28" stroke="${a}" stroke-width="1.5"/>
        <rect x="188" y="142" width="196" height="14" rx="4" fill="#ffffff"/>
        <line x1="188" y1="174" x2="444" y2="174" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="188" y1="196" x2="424" y2="196" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="188" y1="218" x2="340" y2="218" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'script_clapboard':
      return `
        <rect x="172" y="66" width="296" height="168" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.38" stroke-width="2"/>
        <path d="M172 66h296v36H172z" fill="${a}" fill-opacity="0.82"/>
        <path d="M204 66l24 36M264 66l24 36M324 66l24 36M384 66l24 36" stroke="#1c1917" stroke-width="8"/>
        <line x1="204" y1="132" x2="424" y2="132" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="244" y1="162" x2="396" y2="162" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="244" y1="190" x2="364" y2="190" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'editorial_calendar':
      return `
        <rect x="148" y="42" width="344" height="196" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <line x1="148" y1="84" x2="492" y2="84" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5"/>
        <rect x="172" y="102" width="88" height="48" rx="8" fill="${a}" fill-opacity="0.32" stroke="${a}" stroke-width="1.5"/>
        <rect x="276" y="102" width="88" height="48" rx="8" fill="${s}" fill-opacity="0.26" stroke="${s}" stroke-width="1.5"/>
        <rect x="380" y="102" width="88" height="48" rx="8" fill="#ffffff" fill-opacity="0.1"/>
        <rect x="172" y="166" width="88" height="48" rx="8" fill="#ffffff" fill-opacity="0.1"/>
        <rect x="276" y="166" width="88" height="48" rx="8" fill="${a}" fill-opacity="0.32" stroke="${a}" stroke-width="1.5"/>
        <rect x="380" y="166" width="88" height="48" rx="8" fill="#4ade80" fill-opacity="0.24" stroke="#4ade80" stroke-width="1.5"/>`;

    case 'redline_proof':
      return `
        <rect x="164" y="38" width="312" height="204" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.32" stroke-width="2"/>
        <line x1="196" y1="82" x2="356" y2="82" stroke="#ffffff" stroke-opacity="0.4" stroke-width="4" stroke-linecap="round"/>
        <line x1="196" y1="82" x2="300" y2="82" stroke="#f87171" stroke-width="3"/>
        <path d="M316 98l12-16 12 16" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="196" y1="132" x2="432" y2="132" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="196" y1="164" x2="392" y2="164" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="424" cy="196" r="24" fill="#4ade80"/>
        <path d="M414 196l7 7 14-14" fill="none" stroke="#0f172a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    case 'search_snippet':
      return `
        <rect x="148" y="46" width="344" height="46" rx="23" fill="#ffffff" fill-opacity="0.12" stroke="${a}" stroke-width="2"/>
        <circle cx="182" cy="69" r="10" fill="none" stroke="${soft}" stroke-width="2.5"/>
        <line x1="190" y1="77" x2="198" y2="85" stroke="${soft}" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="214" y1="69" x2="366" y2="69" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <rect x="148" y="114" width="344" height="122" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1.5"/>
        <rect x="174" y="138" width="212" height="14" rx="4" fill="${a}"/>
        <line x1="174" y1="172" x2="448" y2="172" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="174" y1="196" x2="404" y2="196" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>`;

    // Entrepreneurship & Business
    case 'venture_launch':
      return `
        <path d="M168 206c64-16 112-62 152-128 18-30 56-40 82-32 8 26-2 64-32 82-66 40-112 88-128 152" fill="none" stroke="${a}" stroke-width="3"/>
        <path d="M320 116l58-58c24-12 50-12 62 0 12 12 12 38 0 62l-58 58-62-62z" fill="${a}" fill-opacity="0.28" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="386" cy="96" r="12" fill="#ffffff"/>
        <path d="M160 214l56-20M184 234l44-16" stroke="${s}" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'partnership_bridge':
      return `
        <rect x="128" y="88" width="116" height="104" rx="14" fill="#ffffff" fill-opacity="0.1" stroke="${soft}" stroke-width="2"/>
        <rect x="396" y="88" width="116" height="104" rx="14" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2"/>
        <path d="M244 124h152" stroke="${s}" stroke-width="3" stroke-dasharray="6 4"/>
        <path d="M244 156h152" stroke="${a}" stroke-width="3"/>
        <circle cx="320" cy="140" r="22" fill="#ffffff"/>
        <path d="M311 140l6 6 13-13" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>`;

    case 'milestone_roadmap':
      return `
        <line x1="126" y1="140" x2="514" y2="140" stroke="${soft}" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>
        <line x1="126" y1="140" x2="360" y2="140" stroke="${a}" stroke-width="5" stroke-linecap="round"/>
        <circle cx="156" cy="140" r="14" fill="${a}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="272" cy="140" r="14" fill="${a}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="388" cy="140" r="14" fill="${s}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="492" cy="140" r="14" fill="#ffffff" fill-opacity="0.2" stroke="${soft}" stroke-width="2"/>
        <rect x="118" y="72" width="76" height="36" rx="8" fill="#ffffff" fill-opacity="0.12"/>
        <rect x="234" y="172" width="76" height="36" rx="8" fill="#ffffff" fill-opacity="0.12"/>
        <rect x="350" y="72" width="76" height="36" rx="8" fill="${s}" fill-opacity="0.24" stroke="${s}"/>`;

    case 'mvp_discovery':
      return `
        <rect x="132" y="54" width="166" height="172" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.32" stroke-width="2"/>
        <rect x="156" y="80" width="118" height="64" rx="8" fill="${a}" fill-opacity="0.24" stroke="${a}"/>
        <line x1="156" y1="168" x2="264" y2="168" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="156" y1="190" x2="234" y2="190" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <path d="M298 140h46" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
        <rect x="344" y="64" width="164" height="68" rx="12" fill="${s}" fill-opacity="0.18" stroke="${s}" stroke-width="1.5"/>
        <rect x="344" y="150" width="164" height="68" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-width="1.5"/>`;

    case 'bmc_canvas':
      return `
        <rect x="132" y="44" width="376" height="192" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <line x1="208" y1="44" x2="208" y2="184" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.5"/>
        <line x1="282" y1="44" x2="282" y2="184" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.5"/>
        <line x1="358" y1="44" x2="358" y2="184" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.5"/>
        <line x1="432" y1="44" x2="432" y2="184" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.5"/>
        <line x1="132" y1="184" x2="508" y2="184" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.5"/>
        <rect x="288" y="54" width="64" height="122" rx="6" fill="${a}" fill-opacity="0.3" stroke="${a}" stroke-width="1.5"/>`;

    case 'market_radar':
      return `
        <circle cx="240" cy="140" r="88" fill="none" stroke="${soft}" stroke-opacity="0.3" stroke-width="1.5"/>
        <circle cx="240" cy="140" r="56" fill="none" stroke="${soft}" stroke-opacity="0.45" stroke-width="1.5"/>
        <circle cx="240" cy="140" r="24" fill="${a}" fill-opacity="0.35" stroke="${a}" stroke-width="2"/>
        <line x1="240" y1="140" x2="306" y2="78" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
        <circle cx="294" cy="92" r="8" fill="${s}"/>
        <rect x="372" y="74" width="136" height="132" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.28"/>
        <rect x="394" y="144" width="20" height="40" rx="3" fill="${soft}"/><rect x="428" y="118" width="20" height="66" rx="3" fill="${a}"/><rect x="462" y="98" width="20" height="86" rx="3" fill="${s}"/>`;

    case 'cashflow_ledger':
      return `
        <rect x="148" y="46" width="344" height="188" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="184" y="148" width="32" height="58" rx="4" fill="${a}"/>
        <rect x="234" y="118" width="32" height="88" rx="4" fill="${s}"/>
        <rect x="284" y="96" width="32" height="110" rx="4" fill="${a}"/>
        <rect x="334" y="78" width="32" height="128" rx="4" fill="${s}"/>
        <circle cx="430" cy="134" r="34" fill="${s}" fill-opacity="0.22" stroke="${s}" stroke-width="2.5"/>
        <path d="M430 116v36M420 124h16a6 6 0 0 1 0 12h-12a6 6 0 0 0 0 12h16" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`;

    case 'ops_dashboard':
      return `
        <rect x="140" y="42" width="360" height="196" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="164" y="66" width="144" height="64" rx="8" fill="${a}" fill-opacity="0.22" stroke="${a}"/>
        <rect x="326" y="66" width="150" height="64" rx="8" fill="${s}" fill-opacity="0.2" stroke="${s}"/>
        <rect x="164" y="146" width="312" height="68" rx="8" fill="#ffffff" fill-opacity="0.07"/>
        <line x1="186" y1="170" x2="362" y2="170" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="186" y1="192" x2="310" y2="192" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>`;

    case 'sales_funnel':
      return `
        <polygon points="164,52 476,52 420,104 220,104" fill="${a}" fill-opacity="0.35" stroke="${a}" stroke-width="2"/>
        <polygon points="224,114 416,114 374,166 266,166" fill="${s}" fill-opacity="0.32" stroke="${s}" stroke-width="2"/>
        <polygon points="272,176 368,176 348,226 292,226" fill="#4ade80" fill-opacity="0.45" stroke="#4ade80" stroke-width="2"/>`;

    case 'crm_lifecycle':
      return `
        <circle cx="186" cy="140" r="34" fill="${a}" fill-opacity="0.24" stroke="${a}" stroke-width="2"/>
        <circle cx="320" cy="140" r="34" fill="${s}" fill-opacity="0.24" stroke="${s}" stroke-width="2"/>
        <circle cx="454" cy="140" r="34" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-width="2"/>
        <path d="M220 140h66M354 140h66" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <path d="M454 98c0-34-268-34-268 0" fill="none" stroke="${a}" stroke-width="2" stroke-dasharray="5 5"/>`;

    case 'brand_system':
      return `
        <rect x="148" y="48" width="166" height="184" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <circle cx="231" cy="122" r="42" fill="${a}" fill-opacity="0.35" stroke="${a}" stroke-width="2.5"/>
        <polygon points="231,96 254,138 208,138" fill="#ffffff"/>
        <rect x="334" y="48" width="158" height="52" rx="10" fill="${a}"/>
        <rect x="334" y="114" width="158" height="52" rx="10" fill="${s}"/>
        <rect x="334" y="180" width="158" height="52" rx="10" fill="#ffffff" fill-opacity="0.2" stroke="#ffffff" stroke-opacity="0.45"/>`;

    case 'product_backlog':
      return `
        <rect x="136" y="46" width="112" height="188" rx="10" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.28"/>
        <rect x="264" y="46" width="112" height="188" rx="10" fill="${a}" fill-opacity="0.16" stroke="${a}" stroke-width="1.5"/>
        <rect x="392" y="46" width="112" height="188" rx="10" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.28"/>
        <rect x="150" y="78" width="84" height="36" rx="6" fill="#ffffff" fill-opacity="0.18"/><rect x="150" y="124" width="84" height="36" rx="6" fill="#ffffff" fill-opacity="0.12"/>
        <rect x="278" y="78" width="84" height="44" rx="6" fill="${a}"/><rect x="278" y="134" width="84" height="36" rx="6" fill="#ffffff" fill-opacity="0.2"/>
        <rect x="406" y="78" width="84" height="36" rx="6" fill="${s}"/>`;

    case 'kanban_gantt':
      return `
        <rect x="136" y="44" width="368" height="192" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="166" y="74" width="144" height="26" rx="6" fill="${a}"/>
        <rect x="228" y="116" width="166" height="26" rx="6" fill="${s}"/>
        <rect x="308" y="158" width="160" height="26" rx="6" fill="#ffffff" fill-opacity="0.85"/>
        <line x1="292" y1="64" x2="292" y2="214" stroke="#facc15" stroke-width="2" stroke-dasharray="4 4"/>`;

    case 'strategy_board':
      return `
        <rect x="164" y="46" width="312" height="188" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="216" y="74" width="52" height="52" fill="#ffffff" fill-opacity="0.14"/><rect x="268" y="126" width="52" height="52" fill="#ffffff" fill-opacity="0.14"/>
        <rect x="320" y="74" width="52" height="52" fill="#ffffff" fill-opacity="0.14"/><rect x="372" y="126" width="52" height="52" fill="#ffffff" fill-opacity="0.14"/>
        <circle cx="242" cy="152" r="16" fill="${a}"/><circle cx="398" cy="100" r="16" fill="${s}"/>
        <path d="M258 144l120-38" stroke="#facc15" stroke-width="3" stroke-dasharray="6 4"/>`;

    case 'contract_terms':
      return `
        <rect x="174" y="38" width="292" height="204" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.32" stroke-width="2"/>
        <line x1="204" y1="84" x2="436" y2="84" stroke="${soft}" stroke-width="3"/>
        <circle cx="348" cy="84" r="10" fill="${a}"/>
        <line x1="204" y1="132" x2="436" y2="132" stroke="${soft}" stroke-width="3"/>
        <circle cx="284" cy="132" r="10" fill="${s}"/>
        <rect x="204" y="172" width="232" height="44" rx="8" fill="${a}" fill-opacity="0.2" stroke="${a}"/>
        <path d="M398 194l7 7 14-14" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`;

    // Digital Marketing & Social Media
    case 'growth_funnel':
      return `
        <path d="M148 204c68-22 114-50 156-96 36-38 78-46 156-56" fill="none" stroke="${a}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M438 42l26 8-12 24" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="176" y="168" width="46" height="54" rx="6" fill="#ffffff" fill-opacity="0.18"/>
        <rect x="248" y="142" width="46" height="80" rx="6" fill="${s}" fill-opacity="0.45"/>
        <rect x="320" y="106" width="46" height="116" rx="6" fill="${a}" fill-opacity="0.65"/>
        <rect x="392" y="76" width="46" height="146" rx="6" fill="#ffffff" fill-opacity="0.88"/>`;

    case 'social_grid':
      return `
        <rect x="164" y="38" width="312" height="204" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="188" y="64" width="80" height="68" rx="8" fill="${a}" fill-opacity="0.35" stroke="${a}"/>
        <rect x="280" y="64" width="80" height="68" rx="8" fill="${s}" fill-opacity="0.28" stroke="${s}"/>
        <rect x="372" y="64" width="80" height="68" rx="8" fill="#ffffff" fill-opacity="0.14"/>
        <rect x="188" y="146" width="80" height="68" rx="8" fill="#ffffff" fill-opacity="0.14"/>
        <rect x="280" y="146" width="80" height="68" rx="8" fill="${a}" fill-opacity="0.35" stroke="${a}"/>
        <rect x="372" y="146" width="80" height="68" rx="8" fill="${s}" fill-opacity="0.28" stroke="${s}"/>`;

    case 'page_storefront':
      return `
        <rect x="160" y="38" width="320" height="204" rx="14" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.32" stroke-width="2"/>
        <rect x="160" y="38" width="320" height="72" rx="14" fill="${a}" fill-opacity="0.28"/>
        <circle cx="216" cy="110" r="28" fill="${s}" stroke="#042f2e" stroke-width="4"/>
        <rect x="262" y="122" width="164" height="14" rx="4" fill="#ffffff"/>
        <rect x="188" y="158" width="264" height="58" rx="8" fill="#ffffff" fill-opacity="0.08" stroke="${soft}" stroke-opacity="0.35"/>`;

    case 'meta_ad_cards':
      return `
        <rect x="172" y="42" width="136" height="196" rx="16" fill="#ffffff" fill-opacity="0.1" stroke="${soft}" stroke-width="2"/>
        <rect x="188" y="68" width="104" height="84" rx="8" fill="${a}" fill-opacity="0.38"/>
        <line x1="188" y1="172" x2="278" y2="172" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <rect x="188" y="192" width="104" height="26" rx="6" fill="${a}"/>
        <rect x="332" y="54" width="144" height="172" rx="14" fill="${s}" fill-opacity="0.18" stroke="${s}" stroke-width="2"/>
        <path d="M356 176l30-32 24 18 40-52" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'campaign_tree':
      return `
        <rect x="248" y="40" width="144" height="44" rx="8" fill="${a}" stroke="#ffffff" stroke-width="1.5"/>
        <path d="M320 84v28M196 112h248M196 112v24M444 112v24" fill="none" stroke="${soft}" stroke-width="2.5"/>
        <rect x="136" y="136" width="120" height="40" rx="8" fill="${s}" fill-opacity="0.28" stroke="${s}"/>
        <rect x="384" y="136" width="120" height="40" rx="8" fill="${s}" fill-opacity="0.28" stroke="${s}"/>
        <rect x="120" y="196" width="72" height="34" rx="6" fill="#ffffff" fill-opacity="0.16"/>
        <rect x="206" y="196" width="72" height="34" rx="6" fill="#ffffff" fill-opacity="0.16"/>
        <rect x="362" y="196" width="72" height="34" rx="6" fill="#ffffff" fill-opacity="0.16"/>
        <rect x="448" y="196" width="72" height="34" rx="6" fill="#ffffff" fill-opacity="0.16"/>`;

    case 'search_ads':
      return `
        <rect x="150" y="44" width="340" height="86" rx="12" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2"/>
        <rect x="174" y="64" width="44" height="20" rx="4" fill="${a}"/>
        <rect x="230" y="66" width="184" height="14" rx="4" fill="#ffffff"/>
        <line x1="174" y1="104" x2="430" y2="104" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="150" y="148" width="340" height="86" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.28"/>
        <rect x="174" y="170" width="212" height="14" rx="4" fill="${s}"/>
        <line x1="174" y1="204" x2="404" y2="204" stroke="#ffffff" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'seo_crawler':
      return `
        <circle cx="320" cy="80" r="24" fill="${a}" stroke="#ffffff" stroke-width="2"/>
        <path d="M320 104v32M200 136h240M200 136v28M320 136v28M440 136v28" fill="none" stroke="${soft}" stroke-width="2.5"/>
        <rect x="148" y="164" width="104" height="56" rx="8" fill="#ffffff" fill-opacity="0.12" stroke="${soft}"/>
        <rect x="268" y="164" width="104" height="56" rx="8" fill="${s}" fill-opacity="0.24" stroke="${s}"/>
        <rect x="388" y="164" width="104" height="56" rx="8" fill="#ffffff" fill-opacity="0.12" stroke="${soft}"/>`;

    case 'sem_split':
      return `
        <rect x="136" y="54" width="170" height="172" rx="12" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2"/>
        <rect x="334" y="54" width="170" height="172" rx="12" fill="${s}" fill-opacity="0.18" stroke="${s}" stroke-width="2"/>
        <path d="M164 186l46-48 30 22 40-52" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="366" y="148" width="24" height="44" rx="4" fill="#ffffff"/><rect x="406" y="122" width="24" height="70" rx="4" fill="${s}"/><rect x="446" y="96" width="24" height="96" rx="4" fill="${a}"/>`;

    case 'drip_sequence':
      return `
        <rect x="122" y="102" width="96" height="76" rx="10" fill="${a}" fill-opacity="0.28" stroke="${a}" stroke-width="2"/>
        <path d="M122 112l48 34 48-34" fill="none" stroke="#ffffff" stroke-width="2"/>
        <line x1="218" y1="140" x2="272" y2="140" stroke="${soft}" stroke-width="3"/>
        <rect x="272" y="102" width="96" height="76" rx="10" fill="${s}" fill-opacity="0.24" stroke="${s}" stroke-width="2"/>
        <path d="M272 112l48 34 48-34" fill="none" stroke="#ffffff" stroke-width="2"/>
        <line x1="368" y1="140" x2="422" y2="140" stroke="${soft}" stroke-width="3"/>
        <circle cx="464" cy="140" r="36" fill="${a}"/>
        <path d="M452 140l9 9 18-18" fill="none" stroke="#042f2e" stroke-width="4" stroke-linecap="round"/>`;

    case 'creator_collab':
      return `
        <circle cx="220" cy="126" r="44" fill="${a}" fill-opacity="0.26" stroke="${a}" stroke-width="2.5"/>
        <circle cx="220" cy="114" r="16" fill="#ffffff"/>
        <path d="M192 154c6-16 50-16 56 0" fill="#ffffff" fill-opacity="0.75"/>
        <path d="M264 126h74" stroke="${soft}" stroke-width="3" stroke-dasharray="6 4"/>
        <rect x="338" y="64" width="166" height="152" rx="12" fill="#ffffff" fill-opacity="0.1" stroke="${s}" stroke-width="2"/>
        <path d="M366 176l34-38 26 20 44-52" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'content_flywheel':
      return `
        <circle cx="320" cy="140" r="82" fill="none" stroke="${a}" stroke-width="4" stroke-dasharray="112 24"/>
        <circle cx="320" cy="140" r="46" fill="${s}" fill-opacity="0.2" stroke="${s}" stroke-width="2"/>
        <circle cx="320" cy="58" r="14" fill="${a}"/><circle cx="402" cy="140" r="14" fill="#ffffff"/><circle cx="320" cy="222" r="14" fill="${s}"/><circle cx="238" cy="140" r="14" fill="${soft}"/>`;

    case 'utm_dashboard':
      return `
        <rect x="144" y="42" width="352" height="196" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <circle cx="236" cy="140" r="52" fill="none" stroke="${s}" stroke-width="18" stroke-dasharray="140 200"/>
        <circle cx="236" cy="140" r="52" fill="none" stroke="${a}" stroke-width="18" stroke-dasharray="110 240" stroke-dashoffset="-145"/>
        <rect x="326" y="78" width="140" height="18" rx="4" fill="${a}"/>
        <rect x="326" y="114" width="112" height="18" rx="4" fill="${s}"/>
        <rect x="326" y="150" width="84" height="18" rx="4" fill="#ffffff" fill-opacity="0.65"/>
        <rect x="326" y="186" width="126" height="18" rx="4" fill="${soft}" fill-opacity="0.5"/>`;

    case 'community_hub':
      return `
        <circle cx="320" cy="140" r="34" fill="${a}"/>
        <circle cx="212" cy="96" r="24" fill="${s}" fill-opacity="0.85"/><circle cx="428" cy="96" r="24" fill="${s}" fill-opacity="0.85"/>
        <circle cx="212" cy="186" r="24" fill="${soft}" fill-opacity="0.75"/><circle cx="428" cy="186" r="24" fill="${soft}" fill-opacity="0.75"/>
        <path d="M236 106l56 22M404 106l-56 22M236 176l56-22M404 176l-56-22" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2.5"/>`;

    case 'lead_capture':
      return `
        <rect x="148" y="54" width="144" height="172" rx="10" fill="${a}" fill-opacity="0.24" stroke="${a}" stroke-width="2"/>
        <line x1="172" y1="98" x2="264" y2="98" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <line x1="172" y1="126" x2="246" y2="126" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M292 140h46" stroke="#ffffff" stroke-width="3"/>
        <rect x="338" y="64" width="160" height="152" rx="12" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <rect x="360" y="92" width="116" height="24" rx="6" fill="#ffffff" fill-opacity="0.16"/>
        <rect x="360" y="128" width="116" height="24" rx="6" fill="#ffffff" fill-opacity="0.16"/>
        <rect x="360" y="168" width="116" height="28" rx="6" fill="${a}"/>`;

    case 'ab_split_test':
      return `
        <rect x="148" y="52" width="154" height="176" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="338" y="52" width="154" height="176" rx="12" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2.5"/>
        <rect x="176" y="156" width="98" height="28" rx="6" fill="#ffffff" fill-opacity="0.25"/>
        <rect x="366" y="156" width="98" height="28" rx="6" fill="${a}"/>
        <circle cx="468" cy="64" r="18" fill="#4ade80"/><path d="M460 64l5 5 11-11" fill="none" stroke="#042f2e" stroke-width="3" stroke-linecap="round"/>`;

    case 'channel_mix':
      return `
        <circle cx="240" cy="140" r="76" fill="none" stroke="${soft}" stroke-width="2"/>
        <path d="M240 140l0-76A76 76 0 0 1 312 164z" fill="${a}" fill-opacity="0.72"/>
        <path d="M240 140l72 24A76 76 0 0 1 176 182z" fill="${s}" fill-opacity="0.65"/>
        <rect x="352" y="76" width="144" height="128" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.3"/>
        <line x1="376" y1="110" x2="472" y2="110" stroke="${a}" stroke-width="6" stroke-linecap="round"/>
        <line x1="376" y1="142" x2="452" y2="142" stroke="${s}" stroke-width="6" stroke-linecap="round"/>
        <line x1="376" y1="174" x2="432" y2="174" stroke="#ffffff" stroke-opacity="0.6" stroke-width="6" stroke-linecap="round"/>`;

    case 'spotlight_card':
      return `
        <rect x="176" y="42" width="288" height="196" rx="14" fill="#ffffff" fill-opacity="0.09" stroke="${a}" stroke-width="2"/>
        <circle cx="244" cy="116" r="36" fill="${a}" fill-opacity="0.3" stroke="${a}" stroke-width="2.5"/>
        <circle cx="244" cy="106" r="13" fill="#ffffff"/>
        <path d="M222 138c6-12 38-12 44 0" fill="#ffffff" fill-opacity="0.8"/>
        <line x1="304" y1="98" x2="434" y2="98" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>
        <line x1="304" y1="126" x2="404" y2="126" stroke="${soft}" stroke-width="4" stroke-linecap="round"/>
        <rect x="208" y="178" width="224" height="32" rx="8" fill="${s}" fill-opacity="0.22" stroke="${s}"/>`;

    // Creative & Design
    case 'poster_artboard':
      return `
        <rect x="164" y="34" width="212" height="212" rx="10" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2"/>
        <circle cx="270" cy="118" r="50" fill="${a}" fill-opacity="0.72"/>
        <rect x="200" y="140" width="96" height="76" rx="8" fill="${s}" fill-opacity="0.55" stroke="#ffffff" stroke-width="1.5"/>
        <rect x="404" y="46" width="84" height="188" rx="10" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.28"/>
        <circle cx="446" cy="84" r="18" fill="${a}"/><circle cx="446" cy="138" r="18" fill="${s}"/><circle cx="446" cy="192" r="18" fill="#ffffff"/>`;

    case 'template_frames':
      return `
        <rect x="148" y="44" width="344" height="192" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="176" y="70" width="136" height="140" rx="8" fill="${a}" fill-opacity="0.26" stroke="${a}" stroke-dasharray="6 4" stroke-width="2"/>
        <rect x="332" y="70" width="132" height="62" rx="8" fill="${s}" fill-opacity="0.35" stroke="${s}"/>
        <rect x="332" y="148" width="132" height="62" rx="8" fill="#ffffff" fill-opacity="0.16"/>`;

    case 'wireframe_flows':
      return `
        <rect x="132" y="54" width="128" height="172" rx="14" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2"/>
        <rect x="150" y="78" width="92" height="44" rx="6" fill="${a}" fill-opacity="0.4"/>
        <rect x="150" y="136" width="92" height="16" rx="4" fill="#ffffff" fill-opacity="0.6"/>
        <rect x="150" y="166" width="68" height="28" rx="6" fill="${s}"/>
        <path d="M260 176h54l26-52h40" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
        <rect x="380" y="54" width="128" height="172" rx="14" fill="#ffffff" fill-opacity="0.1" stroke="${a}" stroke-width="2"/>
        <circle cx="444" cy="116" r="28" fill="${s}" fill-opacity="0.35" stroke="${s}" stroke-width="2"/>
        <rect x="404" y="164" width="80" height="32" rx="6" fill="${a}"/>`;

    case 'infographic_nodes':
      return `
        <rect x="156" y="48" width="328" height="184" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <circle cx="226" cy="110" r="26" fill="${a}"/><circle cx="320" cy="170" r="26" fill="${s}"/><circle cx="414" cy="110" r="26" fill="#ffffff" fill-opacity="0.85"/>
        <path d="M248 124l48 32M344 156l48-32" stroke="${soft}" stroke-width="3"/>`;

    case 'camera_aperture':
      return `
        <rect x="176" y="48" width="288" height="184" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <line x1="272" y1="48" x2="272" y2="232" stroke="#ffffff" stroke-opacity="0.18"/><line x1="368" y1="48" x2="368" y2="232" stroke="#ffffff" stroke-opacity="0.18"/>
        <line x1="176" y1="109" x2="464" y2="109" stroke="#ffffff" stroke-opacity="0.18"/><line x1="176" y1="171" x2="464" y2="171" stroke="#ffffff" stroke-opacity="0.18"/>
        <circle cx="320" cy="140" r="54" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-width="3"/>
        <polygon points="320,104 352,140 320,176 288,140" fill="none" stroke="#ffffff" stroke-width="2.5"/>`;

    case 'nle_timeline':
      return `
        <rect x="132" y="42" width="376" height="196" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="156" y="76" width="134" height="36" rx="6" fill="${a}"/><rect x="302" y="76" width="176" height="36" rx="6" fill="${s}"/>
        <rect x="156" y="128" width="224" height="36" rx="6" fill="${soft}" fill-opacity="0.65"/>
        <rect x="156" y="180" width="322" height="30" rx="6" fill="#ffffff" fill-opacity="0.18"/>
        <line x1="316" y1="54" x2="316" y2="224" stroke="#ffffff" stroke-width="3"/>
        <polygon points="306,54 326,54 316,70" fill="#ffffff"/>`;

    case 'bezier_keyframes':
      return `
        <path d="M148 206C220 206 236 68 320 68S420 206 492 74" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/>
        <line x1="236" y1="68" x2="404" y2="68" stroke="${soft}" stroke-width="2" stroke-dasharray="4 4"/>
        <polygon points="148,194 160,206 148,218 136,206" fill="${s}"/><polygon points="320,54 334,68 320,82 306,68" fill="#ffffff"/>
        <polygon points="492,62 504,74 492,86 480,74" fill="${a}"/>`;

    case 'logo_grid':
      return `
        <circle cx="320" cy="140" r="82" fill="none" stroke="${soft}" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="5 5"/>
        <rect x="238" y="58" width="164" height="164" fill="none" stroke="${soft}" stroke-opacity="0.45" stroke-width="1.5"/>
        <path d="M272 192V88l96 52z" fill="${a}" fill-opacity="0.75" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>`;

    case 'ideation_diamond':
      return `
        <polygon points="148,140 320,56 492,140 320,224" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2.5"/>
        <line x1="320" y1="56" x2="320" y2="224" stroke="${soft}" stroke-width="2" stroke-dasharray="5 5"/>
        <circle cx="320" cy="140" r="22" fill="#ffffff"/>
        <circle cx="320" cy="140" r="9" fill="${s}"/>`;

    case 'moodboard_collage':
      return `
        <rect x="148" y="42" width="160" height="122" rx="10" fill="${a}" fill-opacity="0.35" stroke="${a}" stroke-width="2"/>
        <rect x="326" y="42" width="166" height="84" rx="10" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.4"/>
        <rect x="148" y="178" width="160" height="58" rx="10" fill="#ffffff" fill-opacity="0.12"/>
        <rect x="326" y="142" width="166" height="94" rx="10" fill="${s}" fill-opacity="0.35" stroke="${s}" stroke-width="2"/>`;

    // Technology & Digital
    case 'html_box_model':
      return `
        <rect x="144" y="40" width="352" height="200" rx="14" fill="#ffffff" fill-opacity="0.06" stroke="${soft}" stroke-dasharray="6 4" stroke-width="2"/>
        <rect x="176" y="68" width="288" height="144" rx="10" fill="${a}" fill-opacity="0.16" stroke="${a}" stroke-width="2"/>
        <rect x="212" y="96" width="216" height="88" rx="8" fill="${s}" fill-opacity="0.3" stroke="#ffffff" stroke-width="1.5"/>
        <path d="M286 126l-16 14 16 14M354 126l16 14-16 14M328 120l-16 40" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'code_browser_ui':
      return `
        <rect x="128" y="44" width="184" height="192" rx="12" fill="#0f172a" stroke="${s}" stroke-width="2"/>
        <line x1="152" y1="84" x2="262" y2="84" stroke="${a}" stroke-width="5" stroke-linecap="round"/>
        <line x1="168" y1="112" x2="284" y2="112" stroke="${soft}" stroke-width="4" stroke-linecap="round"/>
        <line x1="168" y1="140" x2="246" y2="140" stroke="#ffffff" stroke-opacity="0.6" stroke-width="4" stroke-linecap="round"/>
        <line x1="152" y1="168" x2="270" y2="168" stroke="${s}" stroke-width="4" stroke-linecap="round"/>
        <rect x="330" y="44" width="182" height="192" rx="12" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.38" stroke-width="2"/>
        <rect x="352" y="72" width="138" height="64" rx="8" fill="${a}" fill-opacity="0.45"/>
        <rect x="352" y="150" width="64" height="58" rx="8" fill="#ffffff" fill-opacity="0.18"/>
        <rect x="426" y="150" width="64" height="58" rx="8" fill="${s}" fill-opacity="0.45"/>`;

    case 'api_endpoints':
      return `
        <rect x="148" y="48" width="344" height="52" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="#4ade80" stroke-width="1.8"/>
        <rect x="168" y="62" width="62" height="24" rx="5" fill="#4ade80"/>
        <line x1="250" y1="74" x2="438" y2="74" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <rect x="148" y="114" width="344" height="52" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${a}" stroke-width="1.8"/>
        <rect x="168" y="128" width="62" height="24" rx="5" fill="${a}"/>
        <line x1="250" y1="140" x2="410" y2="140" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <rect x="148" y="180" width="344" height="52" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${s}" stroke-width="1.8"/>
        <rect x="168" y="194" width="62" height="24" rx="5" fill="${s}"/>
        <line x1="250" y1="206" x2="454" y2="206" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>`;

    case 'three_tier_stack':
      return `
        <rect x="196" y="42" width="248" height="48" rx="10" fill="${a}" fill-opacity="0.3" stroke="${a}" stroke-width="2"/>
        <rect x="196" y="116" width="248" height="48" rx="10" fill="${s}" fill-opacity="0.28" stroke="${s}" stroke-width="2"/>
        <rect x="196" y="190" width="248" height="48" rx="10" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>
        <line x1="320" y1="90" x2="320" y2="116" stroke="#ffffff" stroke-width="2.5"/>
        <line x1="320" y1="164" x2="320" y2="190" stroke="#ffffff" stroke-width="2.5"/>`;

    case 'mobile_screens':
      return `
        <rect x="192" y="34" width="114" height="212" rx="18" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2"/>
        <rect x="210" y="64" width="78" height="70" rx="8" fill="${a}" fill-opacity="0.42"/>
        <line x1="210" y1="154" x2="282" y2="154" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="210" y1="176" x2="262" y2="176" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <rect x="334" y="48" width="114" height="198" rx="18" fill="${s}" fill-opacity="0.16" stroke="${s}" stroke-width="2"/>
        <circle cx="391" cy="118" r="28" fill="${a}" fill-opacity="0.4" stroke="${a}" stroke-width="2"/>
        <rect x="354" y="168" width="74" height="32" rx="8" fill="${s}"/>`;

    case 'erd_tables':
      return `
        <rect x="138" y="48" width="150" height="118" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${a}" stroke-width="2"/>
        <rect x="138" y="48" width="150" height="32" rx="10" fill="${a}" fill-opacity="0.45"/>
        <line x1="158" y1="102" x2="262" y2="102" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="158" y1="128" x2="242" y2="128" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <rect x="352" y="114" width="150" height="118" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${s}" stroke-width="2"/>
        <rect x="352" y="114" width="150" height="32" rx="10" fill="${s}" fill-opacity="0.45"/>
        <line x1="372" y1="168" x2="476" y2="168" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="372" y1="194" x2="452" y2="194" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <path d="M288 108h32v62h32" fill="none" stroke="#ffffff" stroke-width="2.5"/>`;

    case 'security_shield':
      return `
        <path d="M320 36l96 36v66c0 58-42 98-96 116-54-18-96-58-96-116V72z" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="3"/>
        <rect x="288" y="128" width="64" height="52" rx="8" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-width="2"/>
        <path d="M302 128v-16a18 18 0 0 1 36 0v16" fill="none" stroke="#ffffff" stroke-width="3"/>
        <circle cx="320" cy="154" r="6" fill="#4ade80"/>`;

    case 'data_charts':
      return `
        <rect x="148" y="42" width="344" height="196" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="184" y="154" width="28" height="54" rx="4" fill="${soft}" fill-opacity="0.65"/>
        <rect x="234" y="122" width="28" height="86" rx="4" fill="${s}"/>
        <rect x="284" y="94" width="28" height="114" rx="4" fill="${a}"/>
        <rect x="334" y="134" width="28" height="74" rx="4" fill="${s}"/>
        <rect x="384" y="76" width="28" height="132" rx="4" fill="#ffffff"/>
        <path d="M198 136l50-32 50-24 50 38 50-56" fill="none" stroke="#facc15" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'ai_pipeline':
      return `
        <circle cx="172" cy="96" r="16" fill="${s}"/><circle cx="172" cy="184" r="16" fill="${s}"/>
        <circle cx="320" cy="70" r="18" fill="${a}"/><circle cx="320" cy="140" r="20" fill="#ffffff"/><circle cx="320" cy="210" r="18" fill="${a}"/>
        <circle cx="468" cy="140" r="24" fill="#4ade80"/>
        <g stroke="${soft}" stroke-opacity="0.55" stroke-width="2">
          <line x1="188" y1="96" x2="302" y2="70"/><line x1="188" y1="96" x2="300" y2="140"/>
          <line x1="188" y1="184" x2="300" y2="140"/><line x1="188" y1="184" x2="302" y2="210"/>
          <line x1="338" y1="70" x2="444" y2="140"/><line x1="340" y1="140" x2="444" y2="140"/><line x1="338" y1="210" x2="444" y2="140"/>
        </g>`;

    case 'ml_boundary':
      return `
        <rect x="152" y="42" width="336" height="196" rx="12" fill="#ffffff" fill-opacity="0.07" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <path d="M168 214c74-16 110-136 160-136 46 0 72 110 144 36" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="212" cy="94" r="9" fill="${s}"/><circle cx="242" cy="120" r="9" fill="${s}"/><circle cx="196" cy="138" r="9" fill="${s}"/>
        <circle cx="384" cy="176" r="9" fill="#4ade80"/><circle cx="426" cy="196" r="9" fill="#4ade80"/><circle cx="448" cy="156" r="9" fill="#4ade80"/>`;

    case 'cloud_nodes':
      return `
        <path d="M236 164h176a38 38 0 0 0 8-75 56 56 0 0 0-108-14 44 44 0 0 0-76 89z" fill="${a}" fill-opacity="0.22" stroke="#ffffff" stroke-width="2.5"/>
        <line x1="256" y1="164" x2="220" y2="208" stroke="${soft}" stroke-width="2.5"/>
        <line x1="320" y1="164" x2="320" y2="208" stroke="${soft}" stroke-width="2.5"/>
        <line x1="384" y1="164" x2="420" y2="208" stroke="${soft}" stroke-width="2.5"/>
        <rect x="196" y="206" width="48" height="28" rx="6" fill="${s}"/><rect x="296" y="206" width="48" height="28" rx="6" fill="${a}"/><rect x="396" y="206" width="48" height="28" rx="6" fill="${s}"/>`;

    case 'test_assertions':
      return `
        <rect x="156" y="42" width="328" height="196" rx="12" fill="#0f172a" stroke="${a}" stroke-opacity="0.5" stroke-width="2"/>
        <circle cx="196" cy="90" r="12" fill="#4ade80"/><line x1="224" y1="90" x2="426" y2="90" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <circle cx="196" cy="140" r="12" fill="#4ade80"/><line x1="224" y1="140" x2="394" y2="140" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <circle cx="196" cy="190" r="12" fill="#4ade80"/><line x1="224" y1="190" x2="444" y2="190" stroke="${soft}" stroke-width="4" stroke-linecap="round"/>`;

    case 'git_branches':
      return `
        <line x1="164" y1="184" x2="476" y2="184" stroke="${s}" stroke-width="5" stroke-linecap="round"/>
        <path d="M224 184c28 0 36-88 76-88h100c36 0 42 88 76 88" fill="none" stroke="${a}" stroke-width="5" stroke-linecap="round"/>
        <circle cx="224" cy="184" r="13" fill="#ffffff" stroke="${s}" stroke-width="4"/>
        <circle cx="320" cy="96" r="13" fill="${a}" stroke="#ffffff" stroke-width="3"/>
        <circle cx="384" cy="96" r="13" fill="${a}" stroke="#ffffff" stroke-width="3"/>
        <circle cx="476" cy="184" r="14" fill="#4ade80" stroke="#ffffff" stroke-width="3"/>`;

    case 'cicd_loop':
      return `
        <rect x="132" y="108" width="96" height="64" rx="10" fill="${s}" fill-opacity="0.28" stroke="${s}" stroke-width="2"/>
        <rect x="272" y="108" width="96" height="64" rx="10" fill="${a}" fill-opacity="0.28" stroke="${a}" stroke-width="2"/>
        <rect x="412" y="108" width="96" height="64" rx="10" fill="#4ade80" fill-opacity="0.28" stroke="#4ade80" stroke-width="2"/>
        <path d="M228 140h44M368 140h44" stroke="#ffffff" stroke-width="3"/>
        <path d="M460 108c0-48-280-48-280 0" fill="none" stroke="${soft}" stroke-width="2" stroke-dasharray="5 5"/>`;

    case 'ticket_triage':
      return `
        <rect x="148" y="48" width="344" height="184" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <circle cx="212" cy="116" r="24" fill="${a}" fill-opacity="0.25" stroke="${a}" stroke-width="2"/>
        <path d="M202 116l7 7 13-14" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
        <line x1="258" y1="106" x2="452" y2="106" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <line x1="258" y1="130" x2="394" y2="130" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="188" y="168" width="264" height="36" rx="8" fill="#4ade80" fill-opacity="0.22" stroke="#4ade80"/>`;

    case 'workspace_suite':
      return `
        <rect x="136" y="48" width="174" height="184" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-width="1.5"/>
        <rect x="330" y="48" width="174" height="84" rx="10" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-width="1.5"/>
        <rect x="330" y="148" width="174" height="84" rx="10" fill="${s}" fill-opacity="0.22" stroke="${s}" stroke-width="1.5"/>
        <line x1="160" y1="84" x2="276" y2="84" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
        <line x1="160" y1="112" x2="254" y2="112" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>
        <line x1="160" y1="140" x2="268" y2="140" stroke="${soft}" stroke-width="3" stroke-linecap="round"/>`;

    // Career & Professional Development
    case 'resume_sheet':
      return `
        <rect x="184" y="34" width="272" height="212" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.38" stroke-width="2"/>
        <circle cx="234" cy="78" r="20" fill="${a}"/>
        <line x1="272" y1="70" x2="420" y2="70" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <line x1="272" y1="90" x2="376" y2="90" stroke="${soft}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="214" y1="126" x2="426" y2="126" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5"/>
        <rect x="214" y="144" width="166" height="10" rx="3" fill="${a}" fill-opacity="0.8"/>
        <line x1="214" y1="172" x2="420" y2="172" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="214" y1="196" x2="394" y2="196" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3.5" stroke-linecap="round"/>`;

    case 'star_interview':
      return `
        <rect x="136" y="76" width="84" height="128" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-width="1.5"/>
        <rect x="234" y="76" width="84" height="128" rx="10" fill="#ffffff" fill-opacity="0.09" stroke="${soft}" stroke-width="1.5"/>
        <rect x="332" y="76" width="84" height="128" rx="10" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-width="2"/>
        <rect x="430" y="76" width="84" height="128" rx="10" fill="${s}" fill-opacity="0.24" stroke="${s}" stroke-width="2"/>
        <circle cx="374" cy="116" r="14" fill="${a}"/><circle cx="472" cy="116" r="14" fill="${s}"/>`;

    case 'career_ladder':
      return `
        <rect x="152" y="172" width="76" height="62" rx="8" fill="#ffffff" fill-opacity="0.16"/>
        <rect x="242" y="132" width="76" height="102" rx="8" fill="${a}" fill-opacity="0.35" stroke="${a}"/>
        <rect x="332" y="92" width="76" height="142" rx="8" fill="${a}" fill-opacity="0.6" stroke="${a}"/>
        <rect x="422" y="52" width="76" height="182" rx="8" fill="${s}" stroke="#ffffff" stroke-width="2"/>`;

    case 'freelance_scope':
      return `
        <rect x="152" y="44" width="184" height="192" rx="12" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
        <line x1="178" y1="82" x2="306" y2="82" stroke="${a}" stroke-width="5" stroke-linecap="round"/>
        <line x1="178" y1="112" x2="292" y2="112" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="178" y1="140" x2="274" y2="140" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="360" y="64" width="136" height="152" rx="12" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-width="2"/>
        <circle cx="428" cy="126" r="24" fill="#ffffff"/><path d="M419 126l6 6 12-12" fill="none" stroke="#14532d" stroke-width="3" stroke-linecap="round"/>`;

    case 'remote_timezones':
      return `
        <circle cx="212" cy="128" r="46" fill="#ffffff" fill-opacity="0.08" stroke="${soft}" stroke-width="2"/>
        <path d="M212 102v26l18 12" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
        <circle cx="320" cy="128" r="46" fill="${a}" fill-opacity="0.18" stroke="${a}" stroke-width="2"/>
        <path d="M320 100v28l-16 14" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
        <circle cx="428" cy="128" r="46" fill="#ffffff" fill-opacity="0.08" stroke="${s}" stroke-width="2"/>
        <path d="M428 106v22h20" fill="none" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
        <line x1="164" y1="206" x2="476" y2="206" stroke="${soft}" stroke-opacity="0.4" stroke-width="3" stroke-linecap="round"/>`;

    case 'reliability_badge':
      return `
        <circle cx="320" cy="130" r="66" fill="${a}" fill-opacity="0.2" stroke="${a}" stroke-width="3"/>
        <path d="M294 130l18 18 36-38" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M286 188l-16 52 50-24 50 24-16-52" fill="${s}" fill-opacity="0.4" stroke="${s}" stroke-width="2"/>`;

    case 'time_blocks':
      return `
        <rect x="148" y="42" width="344" height="196" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <rect x="172" y="68" width="140" height="72" rx="8" fill="${a}" fill-opacity="0.35" stroke="${a}"/>
        <rect x="328" y="68" width="140" height="72" rx="8" fill="${s}" fill-opacity="0.28" stroke="${s}"/>
        <rect x="172" y="152" width="140" height="62" rx="8" fill="#ffffff" fill-opacity="0.12"/>
        <rect x="328" y="152" width="140" height="62" rx="8" fill="#ffffff" fill-opacity="0.12"/>`;

    case 'focus_streaks':
      return `
        <rect x="156" y="48" width="328" height="184" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <circle cx="212" cy="100" r="14" fill="${a}"/><line x1="242" y1="100" x2="444" y2="100" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <circle cx="212" cy="144" r="14" fill="${a}"/><line x1="242" y1="144" x2="414" y2="144" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
        <circle cx="212" cy="188" r="14" fill="${s}"/><line x1="242" y1="188" x2="432" y2="188" stroke="${soft}" stroke-width="4" stroke-linecap="round"/>`;

    case 'budget_rings':
      return `
        <circle cx="246" cy="140" r="64" fill="none" stroke="${soft}" stroke-opacity="0.22" stroke-width="20"/>
        <circle cx="246" cy="140" r="64" fill="none" stroke="${a}" stroke-width="20" stroke-dasharray="190 400" stroke-linecap="round"/>
        <circle cx="246" cy="140" r="64" fill="none" stroke="${s}" stroke-width="20" stroke-dasharray="110 400" stroke-dashoffset="-205" stroke-linecap="round"/>
        <path d="M352 178l38-34 32 20 56-62" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>`;

    case 'mentor_bridge':
      return `
        <circle cx="206" cy="132" r="38" fill="${a}" fill-opacity="0.28" stroke="${a}" stroke-width="2.5"/>
        <circle cx="434" cy="132" r="38" fill="${s}" fill-opacity="0.28" stroke="${s}" stroke-width="2.5"/>
        <path d="M244 132c48-48 104-48 152 0" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="6 4"/>
        <path d="M244 132h152" stroke="${a}" stroke-width="2.5"/>`;

    case 'case_study_grid':
      return `
        <rect x="132" y="54" width="114" height="172" rx="10" fill="${a}" fill-opacity="0.22" stroke="${a}" stroke-width="2"/>
        <rect x="263" y="54" width="114" height="172" rx="10" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.38" stroke-width="2"/>
        <rect x="394" y="54" width="114" height="172" rx="10" fill="${s}" fill-opacity="0.22" stroke="${s}" stroke-width="2"/>
        <rect x="150" y="76" width="78" height="62" rx="6" fill="${a}"/><rect x="281" y="76" width="78" height="62" rx="6" fill="#ffffff" fill-opacity="0.45"/><rect x="412" y="76" width="78" height="62" rx="6" fill="${s}"/>`;

    case 'client_milestones':
    default:
      return `
        <rect x="148" y="48" width="344" height="184" rx="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>
        <line x1="190" y1="140" x2="450" y2="140" stroke="${soft}" stroke-width="3"/>
        <circle cx="206" cy="140" r="14" fill="${a}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="320" cy="140" r="14" fill="${a}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="434" cy="140" r="14" fill="${s}" stroke="#ffffff" stroke-width="2"/>
        <rect x="172" y="80" width="84" height="32" rx="6" fill="#ffffff" fill-opacity="0.14"/>
        <rect x="278" y="168" width="84" height="32" rx="6" fill="#ffffff" fill-opacity="0.14"/>`;
  }
}

/** @param {SkillCoverInput | null | undefined} skill */
export function buildSkillCoverSvgDataUri(skill) {
  const { palette, scene } = resolveSkillCoverSpec(skill);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280" width="640" height="280">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette.c1}"/>
        <stop offset="100%" stop-color="${palette.c2}"/>
      </linearGradient>
      <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.1" fill="#ffffff" fill-opacity="0.12"/>
      </pattern>
    </defs>
    <rect width="640" height="280" fill="url(#bg)"/>
    <rect width="640" height="280" fill="url(#dots)"/>
    <circle cx="560" cy="36" r="140" fill="${palette.accent}" opacity="0.11"/>
    <circle cx="72" cy="252" r="110" fill="${palette.secondary}" opacity="0.09"/>
    ${renderSceneArtwork(scene, palette)}
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** @param {SkillCoverInput | null | undefined} skill */
export function resolveSkillCover(skill) {
  if (!skill) return '';
  const custom = String(skill.coverUrl || skill.thumbnailUrl || '').trim();
  if (custom.startsWith('https://') || custom.startsWith('data:image/')) {
    return custom;
  }
  return buildSkillCoverSvgDataUri(skill);
}

/**
 * @param {SkillCoverInput | null | undefined} skill
 * @param {{ variant?: 'card' | 'banner'; alt?: string }} [opts]
 */
export function renderSkillCoverHtml(skill, { variant = 'card', alt = '' } = {}) {
  const { palette } = resolveSkillCoverSpec(skill);
  const src = resolveSkillCover(skill);
  const titleText = alt || `${skill?.title || 'Skill'} visual cover`;
  const categoryLabel = skill?.category || palette.label;
  const gradientStyle = `background: linear-gradient(135deg, ${palette.c1} 0%, ${palette.c2} 100%);`;
  const frameClass = variant === 'banner' ? 'skill-cover-frame is-banner' : 'skill-cover-frame';

  if (!src) {
    return `
      <div class="${frameClass}" style="${gradientStyle}">
        <div class="skill-cover-fallback" style="${gradientStyle}">
          <div class="course-thumb-fallback-label" style="color:${palette.accent};">${escapeHtml(categoryLabel)}</div>
          <div class="course-thumb-fallback-title">${escapeHtml(skill?.title || 'Competency')}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="${frameClass}" style="${gradientStyle}">
      <img
        src="${escapeHtml(src)}"
        alt="${escapeHtml(titleText)}"
        referrerpolicy="no-referrer"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="skill-cover-fallback" style="display:none; ${gradientStyle}">
        <div class="course-thumb-fallback-label" style="color:${palette.accent};">${escapeHtml(categoryLabel)}</div>
        <div class="course-thumb-fallback-title">${escapeHtml(skill?.title || 'Competency')}</div>
      </div>
    </div>
  `;
}
