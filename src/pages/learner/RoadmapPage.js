import { getCourseBySlug, getSkillBySlug } from '../../lib/repositories/contentRepository.js';
import { renderCourseDetailsPage } from './CourseDetailsPage.js';
import { renderSkillDetailPage } from './SkillDetailPage.js';

/**
 * Legacy /roadmap/:slug route resolver.
 * Routes to Course Details Overview or Skill Details so existing links continue working seamlessly.
 */
export async function renderRoadmapPage(ctx) {
  const course = await getCourseBySlug(ctx.params.slug);
  if (course) {
    return renderCourseDetailsPage(ctx);
  }
  const skill = await getSkillBySlug(ctx.params.slug);
  if (skill && skill.courses?.length > 0) {
    return renderCourseDetailsPage({
      ...ctx,
      params: { ...ctx.params, slug: skill.courses[0].slug },
    });
  }
  return renderSkillDetailPage(ctx);
}
