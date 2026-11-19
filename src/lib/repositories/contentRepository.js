import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { slugify } from '../formatters.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';

export async function listSkills() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.from('skills').select('*').order('title');
    if (error) throw error;
    return data.map((s) => ({
      ...s,
      roadmapStatus: s.roadmap_status,
      estHours: Number(s.est_hours),
      phases: [],
    }));
  }
  return getDemoState().skills;
}

export async function getSkillBySlug(slug) {
  if (!isDemoMode && supabase) {
    const { data: skill, error } = await supabase
      .from('skills')
      .select('*')
      .eq('slug', slug)
      .single();
    if (error || !skill) return null;

    const { data: phases } = await supabase
      .from('phases')
      .select('*, activities(*)')
      .eq('skill_id', skill.id)
      .order('position');

    const { data: quizzes } = await supabase
      .from('quizzes')
      .select('id, phase_id, quiz_type, title')
      .eq('skill_id', skill.id);

    const { data: challenges } = await supabase
      .from('challenges')
      .select('id, title')
      .eq('skill_id', skill.id);

    const skillCheck = (quizzes || []).find((q) => q.quiz_type === 'skill_check');

    return {
      ...skill,
      roadmapStatus: skill.roadmap_status,
      estHours: Number(skill.est_hours),
      phases: (phases || []).map((p) => ({
        ...p,
        activities: (p.activities || [])
          .sort((a, b) => a.position - b.position)
          .map((a) => ({ ...a, estMinutes: a.est_minutes })),
        quizId: (quizzes || []).find((q) => q.phase_id === p.id)?.id || null,
      })),
      skillCheckQuizId: skillCheck?.id || null,
      challengeId: challenges?.[0]?.id || null,
    };
  }

  return getDemoState().skills.find((s) => s.slug === slug) || null;
}

export async function getChallengeById(challengeId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('challenges')
      .select('*, skills(id, slug, title)')
      .eq('id', challengeId)
      .single();
    if (error) return null;
    return {
      ...data,
      skillId: data.skill_id,
      deliverableHint: data.deliverable_hint,
      skill: data.skills,
    };
  }

  const state = getDemoState();
  const challenge = state.challenges.find((c) => c.id === challengeId);
  if (!challenge) return null;
  const skill = state.skills.find((s) => s.id === challenge.skillId) || null;
  return { ...challenge, skill };
}

export async function adminUpsertSkill(payload) {
  const cleanSlug = payload.slug ? slugify(payload.slug) : slugify(payload.title);
  const key = buildIdempotencyKey('admin-skill', payload.id || cleanSlug, payload.roadmapStatus);

  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('skills')
        .upsert(
          {
            id: payload.id || undefined,
            slug: cleanSlug,
            title: payload.title,
            category: payload.category,
            level: payload.level,
            summary: payload.summary,
            roadmap_status: payload.roadmapStatus,
            est_hours: Number(payload.estHours || 2),
            outcomes: payload.outcomes || [],
          },
          { onConflict: 'slug' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const existing = payload.id
        ? draft.skills.find((s) => s.id === payload.id)
        : draft.skills.find((s) => s.slug === cleanSlug);

      if (existing) {
        existing.title = payload.title.trim();
        existing.slug = cleanSlug;
        existing.category = payload.category;
        existing.level = payload.level;
        existing.summary = payload.summary.trim();
        existing.roadmapStatus = payload.roadmapStatus;
        existing.estHours = Number(payload.estHours || existing.estHours || 2);
        return draft;
      }

      draft.skills.push({
        id: `skill-${cleanSlug}`,
        slug: cleanSlug,
        title: payload.title.trim(),
        category: payload.category,
        level: payload.level,
        summary: payload.summary.trim(),
        roadmapStatus: payload.roadmapStatus || 'coming_soon',
        estHours: Number(payload.estHours || 2),
        outcomes: payload.outcomes?.length
          ? payload.outcomes
          : ['Apply practical techniques from verified resources'],
        phases: [],
        skillCheckQuizId: null,
        challengeId: null,
      });
      return draft;
    });
  });
}

export async function adminAddActivity({ skillId, phaseTitle, title, description, estMinutes, resourceUrl, resourceTitle, verified }) {
  const key = buildIdempotencyKey('admin-activity', skillId, title);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      let { data: phases } = await supabase
        .from('phases')
        .select('*')
        .eq('skill_id', skillId)
        .order('position');
      let phase = phases?.[0];
      if (!phase) {
        const { data: createdPhase, error: phaseErr } = await supabase
          .from('phases')
          .insert({ skill_id: skillId, position: 1, title: phaseTitle || 'Core Practice', summary: '' })
          .select()
          .single();
        if (phaseErr) throw phaseErr;
        phase = createdPhase;
      }
      const { data, error } = await supabase
        .from('activities')
        .insert({
          phase_id: phase.id,
          position: Date.now() % 10000,
          title,
          description,
          est_minutes: Number(estMinutes || 20),
          resources: resourceUrl
            ? [{ title: resourceTitle || title, url: resourceUrl, source: 'External', verified: Boolean(verified) }]
            : [],
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const skill = draft.skills.find((s) => s.id === skillId);
      if (!skill) throw new Error('Skill not found');
      if (!skill.phases || skill.phases.length === 0) {
        skill.phases = [
          {
            id: `phase-${skill.id}-1`,
            position: 1,
            title: phaseTitle || 'Core Foundations',
            summary: 'Structured learning activities and external references.',
            activities: [],
            quizId: null,
          },
        ];
        skill.roadmapStatus = 'full';
      }
      const phase = skill.phases[0];
      const existing = phase.activities.find(
        (a) => a.title.trim().toLowerCase() === title.trim().toLowerCase()
      );
      const resourceObj = resourceUrl
        ? [{ title: resourceTitle || title, url: resourceUrl, source: 'Resource', verified: Boolean(verified) }]
        : [];

      if (existing) {
        existing.description = description.trim();
        existing.estMinutes = Number(estMinutes || 20);
        if (resourceObj.length > 0) existing.resources = resourceObj;
        return draft;
      }

      phase.activities.push({
        id: `act-${Date.now()}`,
        position: phase.activities.length + 1,
        title: title.trim(),
        description: description.trim(),
        estMinutes: Number(estMinutes || 20),
        resources: resourceObj,
      });
      return draft;
    });
  });
}
