import thumbFrontend from '../assets/images/course_thumb_frontend_1795170972196.jpg';
import thumbGraphicDesign from '../assets/images/course_thumb_graphic_design_1795170973075.jpg';
import thumbDigitalMarketing from '../assets/images/course_thumb_digital_marketing_1795170973323.jpg';
import thumbCommunication from '../assets/images/course_thumb_communication_1795170973721.jpg';
import { escapeHtml } from './formatters.js';

export const COURSE_THUMBNAILS = {
  'frontend-development-foundations': thumbFrontend,
  'graphic-design-foundations': thumbGraphicDesign,
  'digital-marketing-foundations': thumbDigitalMarketing,
  'communication-and-public-speaking': thumbCommunication,
};

export function resolveCourseThumbnail(course) {
  if (!course) return '';
  if (course.thumbnailUrl && !course.thumbnailUrl.startsWith('http://')) {
    // Prefer bundled Vite asset when matching a known slug thumbnail key or local /src path
    if (COURSE_THUMBNAILS[course.slug]) return COURSE_THUMBNAILS[course.slug];
    return course.thumbnailUrl;
  }
  return COURSE_THUMBNAILS[course.slug] || '';
}

export function renderCourseThumbnailHtml(course, { height = '176px', alt = '' } = {}) {
  const src = resolveCourseThumbnail(course);
  const titleText = alt || `${course?.title || 'Course'} cover`;
  if (!src) {
    return `
      <div class="course-thumb-fallback" style="height:${height};">
        <div class="course-thumb-fallback-label">${escapeHtml(course?.difficulty || 'Course')}</div>
        <div class="course-thumb-fallback-title">${escapeHtml(course?.title || 'Kord Course')}</div>
      </div>
    `;
  }
  return `
    <div class="course-thumb-frame" style="height:${height};">
      <img
        src="${escapeHtml(src)}"
        alt="${escapeHtml(titleText)}"
        referrerpolicy="no-referrer"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="course-thumb-fallback" style="display:none; height:100%;">
        <div class="course-thumb-fallback-label">${escapeHtml(course?.difficulty || 'Course')}</div>
        <div class="course-thumb-fallback-title">${escapeHtml(course?.title || 'Kord Course')}</div>
      </div>
    </div>
  `;
}
