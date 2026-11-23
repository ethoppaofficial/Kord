import { supabase, isDemoMode } from '../supabase.js';
import {
  getDemoState,
  updateDemoState,
  subscribeDemoState,
  getDemoCurrentUserId,
  setDemoCurrentUserId,
} from '../demo/demoStore.js';
import { appendDemoAuditLog } from '../demo/demoAudit.js';
import { extractFirstName } from '../greeting.js';
import { runSessionCleanup } from '../sessionLifecycle.js';

function detectRecoveryInUrl() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const hash = String(window.location.hash || '');
    const search = String(window.location.search || '');
    return hash.includes('type=recovery') || search.includes('type=recovery');
  } catch {
    return false;
  }
}

export function createAuthService({
  supabaseClient = supabase,
  isDemo = isDemoMode,
  demoStore = {
    getDemoState,
    updateDemoState,
    subscribeDemoState,
    getDemoCurrentUserId,
    setDemoCurrentUserId,
  },
} = {}) {
  let recoveryMode = detectRecoveryInUrl();
  let localAuthPendingCount = 0;

  function useSupabase() {
    return !isDemo && Boolean(supabaseClient);
  }

  function formatDemoSession(state) {
    const currentUserId = demoStore.getDemoCurrentUserId();
    if (!currentUserId) return null;
    const user = (state?.users || []).find((u) => u.id === currentUserId);
    if (!user) return null;
    if ((user.accountStatus || 'active') !== 'active') {
      demoStore.setDemoCurrentUserId(null);
      return null;
    }
    const firstName =
      user.firstName || extractFirstName(user.fullName, user.email.split('@')[0]);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName,
        fullName: user.fullName,
        role: user.role === 'admin' ? 'admin' : 'learner',
        accountStatus: user.accountStatus || 'active',
      },
    };
  }

  async function buildSupabaseSession(authUser, { throwOnSuspended = false } = {}) {
    if (!authUser) return null;
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('id, email, first_name, full_name, role, account_status')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile || !['learner', 'admin'].includes(profile.role)) {
      if (profileError) {
        console.warn('Unable to load user profile:', profileError.message);
      }
      return null;
    }

    const accountStatus = profile.account_status || 'active';
    if (accountStatus !== 'active') {
      try {
        await supabaseClient.auth.signOut();
      } catch {
        // Ignore secondary signOut failure
      }
      if (throwOnSuspended) {
        throw new Error('This account has been suspended. Contact an administrator.');
      }
      return null;
    }

    const emailPrefix = String(authUser.email || 'user').split('@')[0];
    const fullName =
      profile.full_name ||
      authUser.user_metadata?.full_name ||
      emailPrefix;
    const firstName =
      profile.first_name ||
      authUser.user_metadata?.first_name ||
      extractFirstName(fullName, emailPrefix);

    return {
      user: {
        id: authUser.id,
        email: profile.email || authUser.email,
        firstName,
        fullName,
        role: profile.role,
        accountStatus,
      },
    };
  }

  async function getCurrentSession() {
    if (useSupabase()) {
      const { data: sessionData, error } = await supabaseClient.auth.getSession();
      if (error || !sessionData?.session?.user) {
        recoveryMode = false;
        return null;
      }
      if (detectRecoveryInUrl()) {
        recoveryMode = true;
      }
      return buildSupabaseSession(sessionData.session.user);
    }

    return formatDemoSession(demoStore.getDemoState());
  }

  async function signIn({ email, password }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    recoveryMode = false;
    runSessionCleanup();

    if (useSupabase()) {
      localAuthPendingCount += 1;
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw new Error(error.message);
        const authUser = data?.user || data?.session?.user;
        if (authUser) {
          return await buildSupabaseSession(authUser, { throwOnSuspended: true });
        }
        return await getCurrentSession();
      } finally {
        localAuthPendingCount = Math.max(0, localAuthPendingCount - 1);
      }
    }

    const state = demoStore.getDemoState();
    const user = (state.users || []).find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user || user.password !== password) {
      throw new Error('Invalid email or password.');
    }
    if ((user.accountStatus || 'active') !== 'active') {
      throw new Error('This account has been suspended. Contact an administrator.');
    }

    demoStore.setDemoCurrentUserId(user.id);
    return getCurrentSession();
  }

  async function signUp({ firstName, lastName, fullName, email, password }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanFirst = String(firstName || '').trim();
    const cleanLast = String(lastName || '').trim();
    const cleanFull =
      String(fullName || '').trim() || `${cleanFirst} ${cleanLast}`.trim();
    const resolvedFirst = cleanFirst || extractFirstName(cleanFull, cleanEmail.split('@')[0]);

    recoveryMode = false;
    runSessionCleanup();

    if (useSupabase()) {
      localAuthPendingCount += 1;
      try {
        const { data, error } = await supabaseClient.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              first_name: resolvedFirst,
              last_name: cleanLast,
              full_name: cleanFull,
            },
          },
        });
        if (error) throw new Error(error.message);
        if (data?.session?.user) {
          return buildSupabaseSession(data.session.user);
        }
        return getCurrentSession();
      } finally {
        localAuthPendingCount = Math.max(0, localAuthPendingCount - 1);
      }
    }

    const state = demoStore.getDemoState();
    if ((state.users || []).some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error('An account with that email already exists.');
    }

    const assignedRole = 'learner';
    const newUser = {
      id: `user-${Date.now()}`,
      email: cleanEmail,
      firstName: resolvedFirst,
      lastName: cleanLast,
      fullName: cleanFull,
      role: assignedRole,
      accountStatus: 'active',
      password,
      createdAt: new Date().toISOString(),
    };

    demoStore.updateDemoState((draft) => {
      draft.users.push(newUser);
      return draft;
    });
    demoStore.setDemoCurrentUserId(newUser.id);

    return getCurrentSession();
  }

  async function requestPasswordReset(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (useSupabase()) {
      const origin = typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '';
      const { error } = await supabaseClient.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: origin ? `${origin}/reset-password` : undefined,
      });
      if (error) throw new Error(error.message);
      return { sent: true };
    }

    const state = demoStore.getDemoState();
    const exists = (state.users || []).some((u) => u.email.toLowerCase() === cleanEmail);
    return {
      sent: true,
      note: exists
        ? 'Password reset instructions prepared for your account.'
        : 'If an account exists for that email, reset instructions have been sent.',
    };
  }

  async function updatePassword(newPassword) {
    const cleanPassword = String(newPassword || '');
    if (cleanPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    if (useSupabase()) {
      const { error } = await supabaseClient.auth.updateUser({ password: cleanPassword });
      if (error) throw new Error(error.message);
      recoveryMode = false;
      return getCurrentSession();
    }

    const currentUserId = demoStore.getDemoCurrentUserId();
    if (!currentUserId) {
      throw new Error('Active recovery or authenticated session required.');
    }
    demoStore.updateDemoState((draft) => {
      const user = (draft.users || []).find((u) => u.id === currentUserId);
      if (!user) throw new Error('User profile not found.');
      user.password = cleanPassword;
      return draft;
    });
    recoveryMode = false;
    return getCurrentSession();
  }

  async function updateOwnProfile({ firstName, fullName, role }) {
    if (role !== undefined) {
      throw new Error('Profile roles cannot be modified by users.');
    }

    const cleanFirst = String(firstName || '').trim();
    const cleanFull = String(fullName || '').trim();

    if (useSupabase()) {
      const { data: sessionData, error: sessionErr } = await supabaseClient.auth.getSession();
      if (sessionErr || !sessionData.session) {
        throw new Error('Authentication required.');
      }
      const uid = sessionData.session.user.id;
      const { data, error } = await supabaseClient
        .from('profiles')
        .update({
          first_name: cleanFirst,
          full_name: cleanFull,
        })
        .eq('id', uid)
        .select('id, email, first_name, full_name, role')
        .single();
      if (error) throw new Error(error.message);
      return {
        id: data.id,
        email: data.email,
        firstName: data.first_name,
        fullName: data.full_name,
        role: data.role === 'admin' ? 'admin' : 'learner',
      };
    }

    const currentUserId = demoStore.getDemoCurrentUserId();
    if (!currentUserId) {
      throw new Error('Authentication required.');
    }

    let updatedUser = null;
    demoStore.updateDemoState((draft) => {
      const user = (draft.users || []).find((u) => u.id === currentUserId);
      if (!user) throw new Error('User profile not found.');
      if (cleanFirst) user.firstName = cleanFirst;
      if (cleanFull) user.fullName = cleanFull;
      updatedUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        fullName: user.fullName,
        role: user.role,
      };
      return draft;
    });

    return updatedUser;
  }

  async function signOut() {
    recoveryMode = false;
    runSessionCleanup();

    if (useSupabase()) {
      localAuthPendingCount += 1;
      try {
        await supabaseClient.auth.signOut();
      } finally {
        localAuthPendingCount = Math.max(0, localAuthPendingCount - 1);
      }
      return;
    }

    demoStore.setDemoCurrentUserId(null);
  }

  function isPasswordRecoveryMode() {
    return recoveryMode || detectRecoveryInUrl();
  }

  function subscribeAuthChanges(listener) {
    if (typeof listener !== 'function') return () => {};

    if (useSupabase()) {
      let active = true;
      let eventSeq = 0;

      const { data } = supabaseClient.auth.onAuthStateChange((event, rawSession) => {
        if (!active) return;
        const seq = ++eventSeq;
        const initiatedLocally = localAuthPendingCount > 0;

        // Schedule async profile hydration outside Supabase's internal auth lock
        Promise.resolve().then(async () => {
          if (!active || seq !== eventSeq) return;

          if (event === 'SIGNED_OUT') {
            recoveryMode = false;
            runSessionCleanup();
            listener({
              event: 'SIGNED_OUT',
              rawEvent: event,
              session: null,
              crossTab: !initiatedLocally,
            });
            return;
          }

          if (event === 'PASSWORD_RECOVERY') {
            recoveryMode = true;
          } else if (event === 'SIGNED_IN') {
            if (!detectRecoveryInUrl()) {
              recoveryMode = false;
            }
          }

          const resolvedSession = rawSession?.user
            ? await buildSupabaseSession(rawSession.user)
            : null;

          if (!active || seq !== eventSeq) return;

          listener({
            event,
            rawEvent: event,
            session: resolvedSession,
            crossTab: !initiatedLocally,
          });
        });
      });

      return () => {
        active = false;
        data?.subscription?.unsubscribe?.();
      };
    }

    let lastSession = formatDemoSession(demoStore.getDemoState());
    return demoStore.subscribeDemoState((nextState, meta = {}) => {
      const nextSession = formatDemoSession(nextState);
      const prevId = lastSession?.user?.id || null;
      const prevRole = lastSession?.user?.role || null;
      const nextId = nextSession?.user?.id || null;
      const nextRole = nextSession?.user?.role || null;

      if (!meta.fromStorageEvent && prevId === nextId && prevRole === nextRole) {
        return;
      }

      lastSession = nextSession;

      let event = 'USER_UPDATED';
      if (!nextId && prevId) {
        recoveryMode = false;
        event = 'SIGNED_OUT';
      } else if (nextId && nextId !== prevId) {
        recoveryMode = false;
        event = 'SIGNED_IN';
      } else if (!nextId && !prevId) {
        event = 'SIGNED_OUT';
      }

      if (prevId !== nextId || prevRole !== nextRole) {
        runSessionCleanup();
      }

      listener({
        event,
        rawEvent: meta.fromStorageEvent ? 'STORAGE_SYNC' : 'LOCAL_MUTATION',
        session: nextSession,
        crossTab: Boolean(meta.fromStorageEvent),
      });
    });
  }

  return {
    getCurrentSession,
    signIn,
    signUp,
    requestPasswordReset,
    updatePassword,
    updateOwnProfile,
    signOut,
    isPasswordRecoveryMode,
    subscribeAuthChanges,
  };
}

const defaultAuthService = createAuthService();

export const getCurrentSession = defaultAuthService.getCurrentSession;
export const signIn = defaultAuthService.signIn;
export const signUp = defaultAuthService.signUp;
export const requestPasswordReset = defaultAuthService.requestPasswordReset;
export const updatePassword = defaultAuthService.updatePassword;
export const updateOwnProfile = defaultAuthService.updateOwnProfile;
export const signOut = defaultAuthService.signOut;
export const isPasswordRecoveryMode = defaultAuthService.isPasswordRecoveryMode;
export const subscribeAuthChanges = defaultAuthService.subscribeAuthChanges;

// =========================================================================
// Protected Admin User Governance & Audit History APIs
// =========================================================================
export async function adminListUsers() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_list_users');
    if (error) throw new Error(error.message);
    return (data || []).map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name || '',
      fullName: u.full_name || '',
      role: u.role === 'admin' ? 'admin' : 'learner',
      accountStatus: u.account_status || 'active',
      createdAt: u.created_at,
    }));
  }

  const state = getDemoState();
  const actorId = getDemoCurrentUserId();
  const actor = (state.users || []).find((u) => u.id === actorId);
  if (!actor || actor.role !== 'admin' || (actor.accountStatus || 'active') !== 'active') {
    throw new Error('Administrator access required.');
  }

  return (state.users || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName || '',
      fullName: u.fullName || '',
      role: u.role === 'admin' ? 'admin' : 'learner',
      accountStatus: u.accountStatus || 'active',
      createdAt: u.createdAt,
    }));
}

export async function adminSetAccountStatus({
  targetUserId,
  newStatus,
  reason = '',
  actorId = null,
}) {
  if (!['active', 'suspended'].includes(newStatus)) {
    throw new Error('Invalid account status: must be active or suspended.');
  }
  const cleanReason = String(reason || '').trim();

  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_set_account_status', {
      p_target_user_id: targetUserId,
      p_new_status: newStatus,
      p_reason: cleanReason,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  let updatedUser = null;
  updateDemoState((draft) => {
    const resolvedActorId = actorId || getDemoCurrentUserId();
    const actor = (draft.users || []).find((u) => u.id === resolvedActorId);
    if (!actor || actor.role !== 'admin' || (actor.accountStatus || 'active') !== 'active') {
      throw new Error('Administrator access required.');
    }

    const target = (draft.users || []).find((u) => u.id === targetUserId);
    if (!target) {
      throw new Error('Target user profile not found.');
    }
    if (target.id === actor.id) {
      throw new Error('Administrators cannot suspend or modify their own account status.');
    }
    if (target.role === 'admin') {
      throw new Error('Service role authorization required to modify another administrator account status.');
    }

    const prevStatus = target.accountStatus || 'active';
    target.accountStatus = newStatus;

    appendDemoAuditLog(draft, {
      actorId: actor.id,
      action: 'profile_status_changed',
      targetTable: 'profiles',
      targetId: target.id,
      beforeData: { role: target.role, accountStatus: prevStatus },
      afterData: { role: target.role, accountStatus: newStatus },
    });

    if (cleanReason) {
      appendDemoAuditLog(draft, {
        actorId: actor.id,
        action: 'account_status_reason_noted',
        targetTable: 'profiles',
        targetId: target.id,
        beforeData: null,
        afterData: { accountStatus: newStatus, reason: cleanReason.slice(0, 300) },
      });
    }

    updatedUser = {
      id: target.id,
      email: target.email,
      firstName: target.firstName || '',
      fullName: target.fullName || '',
      role: target.role,
      accountStatus: target.accountStatus,
      createdAt: target.createdAt,
    };
    return draft;
  });

  return updatedUser;
}

export async function adminListAuditLogs({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(250, Number(limit || 100)));

  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('id, actor_id, actor_role, action, target_table, target_id, before_data, after_data, created_at')
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      targetTable: row.target_table,
      targetId: row.target_id,
      beforeData: row.before_data,
      afterData: row.after_data,
      createdAt: row.created_at,
    }));
  }

  const state = getDemoState();
  const actorId = getDemoCurrentUserId();
  const actor = (state.users || []).find((u) => u.id === actorId);
  if (!actor || actor.role !== 'admin' || (actor.accountStatus || 'active') !== 'active') {
    throw new Error('Administrator access required.');
  }

  return (state.adminAuditLogs || []).slice(0, safeLimit);
}

