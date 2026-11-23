import { escapeHtml } from './formatters.js';

function buildSvgDataUri(title, eyebrow, c1, c2, accent, motif = 'grid') {
  const safeTitle = String(title || 'Kord Course')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const safeEyebrow = String(eyebrow || 'Kord Academy')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const motifShapes =
    motif === 'code'
      ? `<g opacity="0.22" stroke="${accent}" stroke-width="2" fill="none">
          <rect x="440" y="34" width="160" height="110" rx="12"/>
          <path d="M485 74l-18 16 18 16M555 74l18 16-18 16M528 66l-16 48"/>
        </g>`
      : motif === 'design'
      ? `<g opacity="0.24" fill="${accent}">
          <circle cx="520" cy="84" r="56"/>
          <rect x="446" y="42" width="72" height="72" rx="16" fill="none" stroke="#ffffff" stroke-width="2.5"/>
          <circle cx="545" cy="126" r="24" fill="#ffffff" opacity="0.35"/>
        </g>`
      : motif === 'growth'
      ? `<g opacity="0.26" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M430 142l42-38 34 22 56-62"/>
          <path d="M536 64h26v26"/>
          <circle cx="472" cy="104" r="5" fill="#ffffff"/>
          <circle cx="506" cy="126" r="5" fill="#ffffff"/>
        </g>`
      : `<g opacity="0.24" stroke="${accent}" stroke-width="2.5" fill="none">
          <rect x="444" y="46" width="136" height="84" rx="18"/>
          <path d="M472 130l-12 24 28-14" fill="${accent}" opacity="0.4"/>
          <line x1="472" y1="78" x2="552" y2="78"/>
          <line x1="472" y1="98" x2="526" y2="98"/>
        </g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280" width="640" height="280">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="640" height="280" fill="url(#bg)"/>
    <circle cx="560" cy="40" r="140" fill="${accent}" opacity="0.12"/>
    <circle cx="80" cy="260" r="110" fill="${accent}" opacity="0.09"/>
    ${motifShapes}
    <text x="36" y="182" fill="${accent}" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" letter-spacing="1.6">${safeEyebrow.toUpperCase()}</text>
    <text x="36" y="218" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="25" font-weight="700">${safeTitle}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const COURSE_THUMBNAILS = {
  'frontend-development-foundations': buildSvgDataUri(
    'Frontend Development Foundations',
    'Technology & Digital • Flagship',
    '#0f172a',
    '#1e3a8a',
    '#60a5fa',
    'code'
  ),
  'graphic-design-foundations': buildSvgDataUri(
    'Graphic Design Foundations',
    'Creative & Design • Flagship',
    '#1e1b4b',
    '#701a75',
    '#f472b6',
    'design'
  ),
  'digital-marketing-foundations': buildSvgDataUri(
    'Digital Marketing Foundations',
    'Digital Marketing • Flagship',
    '#064e3b',
    '#0f766e',
    '#34d399',
    'growth'
  ),
  'communication-and-public-speaking': buildSvgDataUri(
    'Communication & Public Speaking',
    'Communication & Interpersonal • Flagship',
    '#311042',
    '#9a3412',
    '#fbbf24',
    'speak'
  ),
};

const CATEGORY_THEMES = {
  'cat-communication': { c1: '#1e1b4b', c2: '#9a3412', accent: '#fbbf24', label: 'Communication & Interpersonal' },
  'cat-writing': { c1: '#1c1917', c2: '#7c2d12', accent: '#fdba74', label: 'Writing & Content Creation' },
  'cat-business': { c1: '#0f172a', c2: '#1e40af', accent: '#93c5fd', label: 'Entrepreneurship & Business' },
  'cat-marketing': { c1: '#064e3b', c2: '#0f766e', accent: '#6ee7b7', label: 'Digital Marketing & Social Media' },
  'cat-creative': { c1: '#3b0764', c2: '#be185d', accent: '#f9a8d4', label: 'Creative & Design' },
  'cat-tech': { c1: '#020617', c2: '#1d4ed8', accent: '#60a5fa', label: 'Technology & Digital' },
  'cat-career': { c1: '#14532d', c2: '#1e3a8a', accent: '#86efac', label: 'Career & Professional' },
};

function getThemeForCourse(course) {
  const catId = String(course?.categoryId || '').toLowerCase();
  if (CATEGORY_THEMES[catId]) return CATEGORY_THEMES[catId];
  const slug = String(course?.slug || '').toLowerCase();
  if (/write|writing|blog|script|seo-w|copy|edit/.test(slug)) return CATEGORY_THEMES['cat-writing'];
  if (/market|ads|social|email-c|email-m|analytics|lead|cro|seo|sem|search-m|paid-social|community-g/.test(slug)) {
    return CATEGORY_THEMES['cat-marketing'];
  }
  if (/design|ui-ux|photo|video|motion|art|canva|brand-identity/.test(slug)) return CATEGORY_THEMES['cat-creative'];
  if (/dev|data|cyber|ai|machine|cloud|test|devops|version|database|support|productivity-tools|backend|mobile-apps|web-dev|git/.test(slug)) {
    return CATEGORY_THEMES['cat-tech'];
  }
  if (/business|startup|finance|sales|crm|product|project|strateg|negotiation/.test(slug) && !/personal-finance/.test(slug)) {
    return CATEGORY_THEMES['cat-business'];
  }
  if (/resume|cv|interview|career|freelanc|remote|workplace|time|networking|portfolio|client|personal-finance/.test(slug)) {
    return CATEGORY_THEMES['cat-career'];
  }
  return { c1: '#0f172a', c2: '#1e3a8a', accent: '#93c5fd', label: course?.difficulty || 'Course' };
}

export function resolveCourseThumbnail(course) {
  if (!course) return '';
  if (COURSE_THUMBNAILS[course.slug]) return COURSE_THUMBNAILS[course.slug];
  const raw = String(course.thumbnailUrl || '').trim();
  if (raw.startsWith('https://') || raw.startsWith('data:image/')) {
    return raw;
  }
  return '';
}

export function renderCourseThumbnailHtml(course, { height = '176px', alt = '' } = {}) {
  const src = resolveCourseThumbnail(course);
  const titleText = alt || `${course?.title || 'Course'} cover`;
  const theme = getThemeForCourse(course);
  const eyebrow = `${course?.difficulty || 'Beginner'} • ${theme.label}`;
  const gradientStyle = `background: linear-gradient(135deg, ${theme.c1} 0%, ${theme.c2} 100%);`;

  if (!src) {
    return `
      <div class="course-thumb-fallback" style="height:${height}; ${gradientStyle}">
        <div class="course-thumb-fallback-label" style="color:${theme.accent};">${escapeHtml(eyebrow)}</div>
        <div class="course-thumb-fallback-title">${escapeHtml(course?.title || 'Kord Course')}</div>
      </div>
    `;
  }
  return `
    <div class="course-thumb-frame" style="height:${height}; ${gradientStyle}">
      <img
        src="${escapeHtml(src)}"
        alt="${escapeHtml(titleText)}"
        referrerpolicy="no-referrer"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="course-thumb-fallback" style="display:none; height:100%; ${gradientStyle}">
        <div class="course-thumb-fallback-label" style="color:${theme.accent};">${escapeHtml(eyebrow)}</div>
        <div class="course-thumb-fallback-title">${escapeHtml(course?.title || 'Kord Course')}</div>
      </div>
    </div>
  `;
}
