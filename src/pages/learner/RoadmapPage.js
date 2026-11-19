import { getCourseBySlug, getSkillBySlug } from '../../lib/repositories/contentRepository.js';
import { renderCourseWorkspacePage } from './CourseWorkspacePage.js';
import { renderSkillDetailPage } from './SkillDetailPage.js';

/**
 * Legacy /roadmap/:slug route resolver.
 * Seamlessly routes to a matching Course workspace or parent Skill overview
 * so existing links and bookmarks continue to work.
 */
export async function renderRoadmapPage(ctx) {
  const course = await getCourseBySlug(ctx.params.slug);
  if (course) {
    return renderCourseWorkspacePage(ctx);
  }
  const skill = await getSkillBySlug(ctx.params.slug);
  if (skill && skill.courses?.length > 0) {
    return renderCourseWorkspacePage({
      ...ctx,
      params: { ...ctx.params, slug: skill.courses[0].slug },
    });
  }
  return renderSkillDetailPage(ctx);
}
