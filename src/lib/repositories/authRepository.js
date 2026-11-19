import { supabase, isDemoMode } from '../supabase.js';
import { ADMIN_EMAIL } from '../constants.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { extractFirstName } from '../greeting.js';

export async function getCurrentSession() {
  if (!isDemoMode && supabase) {
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error || !sessionData.session) return null;
    const authUser = sessionData.session.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', authUser.id)
      .single();

    const fullName =
      profile?.full_name ||
      authUser.user_metadata?.full_name ||
      authUser.email.split('@')[0];
    const firstName =
      authUser.user_metadata?.first_name ||
      extractFirstName(fullName, authUser.email.split('@')[0]);

    return {
      user: {
        id: authUser.id,
        email: profile?.email || authUser.email,
        firstName,
        fullName,
        role: profile?.role || 'learner',
      },
    };
  }

  const state = getDemoState();
  if (!state.currentUserId) return null;
  const user = state.users.find((u) => u.id === state.currentUserId);
  if (!user) return null;
  const firstName =
    user.firstName || extractFirstName(user.fullName, user.email.split('@')[0]);
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName,
      fullName: user.fullName,
      role: user.role,
    },
  };
}

export async function signIn({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) throw new Error(error.message);
    return getCurrentSession();
  }

  const state = getDemoState();
  const user = state.users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!user || user.password !== password) {
    throw new Error('Invalid email or password.');
  }

  updateDemoState((draft) => {
    draft.currentUserId = user.id;
    return draft;
  });
  return getCurrentSession();
}

export async function signUp({ firstName, lastName, fullName, email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanFirst = String(firstName || '').trim();
  const cleanLast = String(lastName || '').trim();
  const cleanFull =
    String(fullName || '').trim() || `${cleanFirst} ${cleanLast}`.trim();
  const resolvedFirst = cleanFirst || extractFirstName(cleanFull, cleanEmail.split('@')[0]);

  if (!isDemoMode && supabase) {
    const { error } = await supabase.auth.signUp({
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
    return getCurrentSession();
  }

  const state = getDemoState();
  if (state.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
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

  updateDemoState((draft) => {
    draft.users.push(newUser);
    draft.currentUserId = newUser.id;
    return draft;
  });

  return getCurrentSession();
}

export async function requestPasswordReset(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!isDemoMode && supabase) {
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) throw new Error(error.message);
    return { sent: true };
  }

  const state = getDemoState();
  const exists = state.users.some((u) => u.email.toLowerCase() === cleanEmail);
  return {
    sent: true,
    note: exists
      ? 'Password reset instructions prepared for your account.'
      : 'If an account exists for that email, reset instructions have been sent.',
  };
}

export async function signOut() {
  if (!isDemoMode && supabase) {
    await supabase.auth.signOut();
    return;
  }
  updateDemoState((draft) => {
    draft.currentUserId = null;
    return draft;
  });
}
