import { getCourseBySlug, getSkillBySlug } from '../../lib/repositories/contentRepository.js';
import { renderCourseDetailsPage } from './CourseDetailsPage.js';
import { renderSkillDetailPage } from './SkillDetailPage.js';

/**
 * Legacy /roadmap/:slug route resolver.
 * Routes to Course Details Overview or Skill Details so existing links continue working seamlessly.
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderRoadmapPage(ctx) {
  const course = await getCourseBySlug(ctx.params.slug);
  if (course) {
    return renderCourseDetailsPage(ctx);
  }
  const skill = await getSkillBySlug(ctx.params.slug);
  const firstCourse = skill?.courses?.[0];
  if (firstCourse?.slug) {
    return renderCourseDetailsPage({
      ...ctx,
      params: { ...ctx.params, slug: firstCourse.slug },
    });
  }
  return renderSkillDetailPage(ctx);
}
