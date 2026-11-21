import { supabase, isDemoMode } from '../supabase.js';
import { ADMIN_EMAIL } from '../constants.js';
import {
  getDemoState,
  updateDemoState,
  subscribeDemoState,
  getDemoCurrentUserId,
  setDemoCurrentUserId,
} from '../demo/demoStore.js';
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
    const firstName =
      user.firstName || extractFirstName(user.fullName, user.email.split('@')[0]);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName,
        fullName: user.fullName,
        role: user.role === 'admin' ? 'admin' : 'learner',
      },
    };
  }

  async function buildSupabaseSession(authUser) {
    if (!authUser) return null;
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('id, email, first_name, full_name, role')
      .eq('id', authUser.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.warn('Unable to load user profile:', profileError.message);
      if (profileError.status === 401 || profileError.status === 403) {
        return null;
      }
    }

    const emailPrefix = String(authUser.email || 'user').split('@')[0];
    const fullName =
      profile?.full_name ||
      authUser.user_metadata?.full_name ||
      emailPrefix;
    const firstName =
      profile?.first_name ||
      authUser.user_metadata?.first_name ||
      extractFirstName(fullName, emailPrefix);

    // Strictly resolve role from authoritative profiles table; never trust client metadata
    const role = profile?.role === 'admin' ? 'admin' : 'learner';

    return {
      user: {
        id: authUser.id,
        email: profile?.email || authUser.email,
        firstName,
        fullName,
        role,
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
          return await buildSupabaseSession(authUser);
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

    const assignedRole = cleanEmail === ADMIN_EMAIL ? 'admin' : 'learner';
    const newUser = {
      id: `user-${Date.now()}`,
      email: cleanEmail,
      firstName: resolvedFirst,
      lastName: cleanLast,
      fullName: cleanFull,
      role: assignedRole,
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
