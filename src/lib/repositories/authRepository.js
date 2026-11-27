import { supabase, isDemoMode, resolveAuthRedirectUrl } from '../supabase.js';
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
import { isValidEmail } from '../validators.js';

function parseRecoveryCallbackFromUrl() {
  try {
    if (typeof window === 'undefined' || !window.location) {
      return {
        error: null,
        errorCode: null,
        errorDescription: null,
        code: null,
        flowId: null,
        tokenHash: null,
        type: null,
        hasAccessToken: false,
      };
    }
    const searchParams = new URLSearchParams(String(window.location.search || ''));
    const rawHash = String(window.location.hash || '').replace(/^#/, '');
    const hashParams = new URLSearchParams(rawHash);
    return {
      error: searchParams.get('error') || hashParams.get('error') || null,
      errorCode: searchParams.get('error_code') || hashParams.get('error_code') || null,
      errorDescription:
        searchParams.get('error_description') || hashParams.get('error_description') || null,
      code: searchParams.get('code') || null,
      flowId: searchParams.get('flow_id') || null,
      tokenHash: searchParams.get('token_hash') || null,
      type: searchParams.get('type') || hashParams.get('type') || null,
      hasAccessToken: Boolean(hashParams.get('access_token')),
    };
  } catch {
    return {
      error: null,
      errorCode: null,
      errorDescription: null,
      code: null,
      flowId: null,
      tokenHash: null,
      type: null,
      hasAccessToken: false,
    };
  }
}

function stripRecoveryParamsFromUrl() {
  try {
    if (typeof window === 'undefined' || !window.location || !window.history?.replaceState) {
      return;
    }
    const searchParams = new URLSearchParams(String(window.location.search || ''));
    const keysToStrip = [
      'code',
      'state',
      'flow_id',
      'token_hash',
      'type',
      'error',
      'error_code',
      'error_description',
    ];
    let changed = false;
    for (const key of keysToStrip) {
      if (searchParams.has(key)) {
        searchParams.delete(key);
        changed = true;
      }
    }
    const rawHash = String(window.location.hash || '');
    const hasAuthHash =
      rawHash.includes('access_token=') ||
      rawHash.includes('refresh_token=') ||
      rawHash.includes('type=recovery') ||
      rawHash.includes('error=');
    if (hasAuthHash) changed = true;
    if (!changed) return;

    const remainingQuery = searchParams.toString();
    const cleanUrl = `${window.location.pathname || '/reset-password'}${remainingQuery ? `?${remainingQuery}` : ''}`;
    window.history.replaceState(window.history.state || {}, '', cleanUrl);
  } catch {
    // Ignore history cleanup failures in constrained environments
  }
}

/**
 * @param {{ errorCode?: string | null; errorDescription?: string | null; rawMessage?: string | null }} [opts]
 * @returns {string}
 */
function mapRecoveryErrorMessage({ errorCode = null, errorDescription = null, rawMessage = null } = {}) {
  const combined = [errorCode, errorDescription, rawMessage].filter(Boolean).join(' ');
  if (errorCode === 'otp_expired' || /expired/i.test(combined)) {
    return 'This password reset link has expired. Request a new reset link to continue.';
  }
  if (/code verifier/i.test(combined)) {
    return 'This recovery link could not be verified in this browser tab. Open it in the same tab where you requested it, or request a new reset link.';
  }
  if (/invalid|already|used|not found|pkce|exchange/i.test(combined)) {
    return 'This password reset link is invalid or has already been used. Request a new reset link to continue.';
  }
  if (errorDescription || rawMessage) {
    return String(errorDescription || rawMessage).trim().slice(0, 220);
  }
  return 'This password reset link is invalid or has expired. Request a new reset link to continue.';
}

/**
 * @param {{ error?: string | null; errorCode?: string | null; errorDescription?: string | null; rawMessage?: string | null }} [opts]
 * @returns {string}
 */
function mapOAuthErrorMessage({ error = null, errorCode = null, errorDescription = null, rawMessage = null } = {}) {
  const combined = [error, errorCode, errorDescription, rawMessage].filter(Boolean).join(' ');
  if (error === 'access_denied' || errorCode === 'access_denied' || /denied|cancel/i.test(combined)) {
    return 'Google sign-in was cancelled. You can try again whenever you are ready.';
  }
  if (errorCode === 'bad_oauth_callback' || /state parameter missing|oauth state/i.test(combined)) {
    return 'Google sign-in could not be verified because the session state expired or was missing. Please try signing in again.';
  }
  if (/code verifier/i.test(combined)) {
    return 'Google sign-in could not be verified in this browser tab. Please start Google sign-in again from this tab.';
  }
  if (/suspended/i.test(combined)) {
    return 'This account has been suspended. Contact an administrator.';
  }
  if (/invalid|expired|already|used|exchange/i.test(combined)) {
    return 'This Google sign-in callback is invalid or has expired. Please try signing in again.';
  }
  if (errorDescription || rawMessage) {
    return String(errorDescription || rawMessage).trim().slice(0, 220);
  }
  return 'Unable to complete Google sign-in. Please try again.';
}

/**
 * @param {{
 *   supabaseClient?: import('../../types/kord.d.ts').AppSupabaseClient | null;
 *   isDemo?: boolean;
 *   demoStore?: import('../../types/kord.d.ts').DemoStoreLike;
 * }} [opts]
 * @returns {import('../../types/kord.d.ts').AuthService}
 */
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
  let recoveryMode = false;
  let localAuthPendingCount = 0;
  /** @type {Map<string, { status: 'ready' | 'invalid_link'; error: string | null }>} */
  const processedRecoveryCallbacks = new Map();
  /** @type {Map<string, { status: 'authenticated' | 'error'; error: string | null }>} */
  const processedOAuthCallbacks = new Map();

  /** @returns {import('../../types/kord.d.ts').AppSupabaseClient | null} */
  function getSupabaseClient() {
    return !isDemo && supabaseClient ? supabaseClient : null;
  }

  /**
   * @param {import('../../types/kord.d.ts').DemoState | null | undefined} state
   * @returns {import('../../types/kord.d.ts').AuthSession | null}
   */
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

  /**
   * @param {import('../../types/kord.d.ts').SupabaseAuthUserLike | null | undefined} authUser
   * @param {{ throwOnSuspended?: boolean }} [opts]
   * @returns {Promise<import('../../types/kord.d.ts').AuthSession | null>}
   */
  async function buildSupabaseSession(authUser, { throwOnSuspended = false } = {}) {
    const client = getSupabaseClient();
    if (!authUser || !client) return null;
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id, email, first_name, full_name, role, account_status')
      .eq('id', authUser.id)
      .single();

    const profileRecord = /** @type {Record<string, unknown> | null} */ (profile);
    const profileRole = profileRecord?.role;
    if (profileError || !profileRecord || (profileRole !== 'learner' && profileRole !== 'admin')) {
      if (profileError) {
        console.warn('Unable to load user profile:', profileError.message);
      }
      return null;
    }

    const accountStatus = String(profileRecord.account_status || 'active') === 'suspended' ? 'suspended' : 'active';
    if (accountStatus !== 'active') {
      try {
        await client.auth.signOut();
      } catch {
        // Ignore secondary signOut failure
      }
      if (throwOnSuspended) {
        throw new Error('This account has been suspended. Contact an administrator.');
      }
      return null;
    }

    const emailPrefix = String(authUser.email || 'user').split('@')[0];
    const meta = authUser.user_metadata || {};
    const fullName = String(
      profileRecord.full_name || meta.full_name || meta.name || emailPrefix
    );
    const firstName = String(
      profileRecord.first_name ||
        meta.first_name ||
        meta.given_name ||
        extractFirstName(fullName, emailPrefix)
    );

    return {
      user: {
        id: authUser.id,
        email: String(profileRecord.email || authUser.email || ''),
        firstName,
        fullName,
        role: profileRole,
        accountStatus,
      },
    };
  }

  async function getCurrentSession() {
    const client = getSupabaseClient();
    if (client) {
      const { data: sessionData, error } = await client.auth.getSession();
      if (error || !sessionData?.session?.user) {
        recoveryMode = false;
        return null;
      }
      const cb = parseRecoveryCallbackFromUrl();
      if (cb.hasAccessToken && cb.type === 'recovery') {
        recoveryMode = true;
      }
      return buildSupabaseSession(sessionData.session.user);
    }

    return formatDemoSession(demoStore.getDemoState());
  }

  /** @param {{ email: string; password: string }} creds */
  async function signIn({ email, password }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    recoveryMode = false;
    runSessionCleanup();

    const client = getSupabaseClient();
    if (client) {
      localAuthPendingCount += 1;
      try {
        const { data, error } = await client.auth.signInWithPassword({
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

  /** @param {{ firstName: string; lastName: string; fullName?: string; email: string; password: string }} creds */
  async function signUp({ firstName, lastName, fullName, email, password }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanFirst = String(firstName || '').trim();
    const cleanLast = String(lastName || '').trim();
    const cleanFull =
      String(fullName || '').trim() || `${cleanFirst} ${cleanLast}`.trim();
    const resolvedFirst = cleanFirst || extractFirstName(cleanFull, cleanEmail.split('@')[0]);

    recoveryMode = false;
    runSessionCleanup();

    const client = getSupabaseClient();
    if (client) {
      localAuthPendingCount += 1;
      try {
        const { data, error } = await client.auth.signUp({
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

    /** @type {import('../../types/kord.d.ts').KordUser} */
    const newUser = {
      id: `user-${Date.now()}`,
      email: cleanEmail,
      firstName: resolvedFirst,
      lastName: cleanLast,
      fullName: cleanFull,
      role: 'learner',
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

  /** @param {string} email */
  async function recoverPassword(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      throw new Error('Enter a valid email address.');
    }

    const neutralNote =
      'If an account exists for that email, reset instructions have been sent.';

    const client = getSupabaseClient();
    if (client) {
      const redirectTo = resolveAuthRedirectUrl('/reset-password');
      const authApi = /** @type {import('../../types/kord.d.ts').SupabaseAuthLike} */ (
        /** @type {unknown} */ (client.auth)
      );
      const result =
        typeof authApi?.resetPasswordForEmail === 'function'
          ? await authApi.resetPasswordForEmail(cleanEmail, { redirectTo })
          : typeof authApi?.recoverPassword === 'function'
            ? await authApi.recoverPassword(cleanEmail, { redirectTo })
            : null;
      if (result?.error) throw new Error(result.error.message);
      return { sent: true, email: cleanEmail, note: neutralNote };
    }

    return {
      sent: true,
      email: cleanEmail,
      note: neutralNote,
    };
  }

  /** @param {string} email */
  async function requestPasswordReset(email) {
    return recoverPassword(email);
  }

  async function signInWithGoogle() {
    recoveryMode = false;
    runSessionCleanup();

    const client = getSupabaseClient();
    if (!client) {
      throw new Error(
        'Google Sign-In requires a live Supabase connection and is unavailable in local demo mode.'
      );
    }

    if (typeof client.auth?.signInWithOAuth !== 'function') {
      throw new Error('Google Sign-In is unavailable in this environment.');
    }

    const redirectTo = resolveAuthRedirectUrl('/auth/callback');
    localAuthPendingCount += 1;
    try {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error) {
        throw new Error(error.message || 'Unable to start Google Sign-In.');
      }
      if (!data?.url) {
        throw new Error('Google Sign-In did not return an authorization URL.');
      }
      return {
        provider: 'google',
        url: data.url,
        redirectTo,
      };
    } finally {
      localAuthPendingCount = Math.max(0, localAuthPendingCount - 1);
    }
  }

  /** @returns {Promise<import('../../types/kord.d.ts').OAuthCallbackState>} */
  async function resolveOAuthCallback() {
    const cb = parseRecoveryCallbackFromUrl();

    if (cb.error || cb.errorCode || cb.errorDescription) {
      stripRecoveryParamsFromUrl();
      const existingSession = await getCurrentSession();
      return {
        status: 'error',
        session: existingSession,
        error: mapOAuthErrorMessage(cb),
      };
    }

    if (cb.code) {
      const cacheKey = `oauth:${cb.code}`;
      const cached = processedOAuthCallbacks.get(cacheKey);
      if (cached) {
        stripRecoveryParamsFromUrl();
        const session = await getCurrentSession();
        if (cached.status === 'authenticated' && session) {
          return { status: 'authenticated', session, error: null };
        }
        return {
          status: 'error',
          session,
          error: cached.error || mapOAuthErrorMessage(),
        };
      }

      const client = getSupabaseClient();
      if (!client) {
        stripRecoveryParamsFromUrl();
        const msg = 'Google Sign-In callback cannot be verified in local demo mode.';
        processedOAuthCallbacks.set(cacheKey, { status: 'error', error: msg });
        return { status: 'error', session: await getCurrentSession(), error: msg };
      }

      const preSession = await getCurrentSession();
      const stillHasCode = Boolean(parseRecoveryCallbackFromUrl().code);

      if (!stillHasCode && preSession) {
        recoveryMode = false;
        processedOAuthCallbacks.set(cacheKey, { status: 'authenticated', error: null });
        return { status: 'authenticated', session: preSession, error: null };
      }

      const authApi = /** @type {import('../../types/kord.d.ts').SupabaseAuthLike} */ (
        /** @type {unknown} */ (client.auth)
      );
      if (typeof authApi?.exchangeCodeForSession !== 'function') {
        stripRecoveryParamsFromUrl();
        const msg = 'Google Sign-In code exchange is unavailable.';
        processedOAuthCallbacks.set(cacheKey, { status: 'error', error: msg });
        return { status: 'error', session: preSession, error: msg };
      }

      localAuthPendingCount += 1;
      try {
        const { data, error } = cb.flowId
          ? await authApi.exchangeCodeForSession(cb.code, { flowId: cb.flowId })
          : await authApi.exchangeCodeForSession(cb.code);
        stripRecoveryParamsFromUrl();

        if (error || !data?.session?.user) {
          const msg = mapOAuthErrorMessage({
            rawMessage: error?.message || 'Invalid or expired Google sign-in code.',
          });
          processedOAuthCallbacks.set(cacheKey, { status: 'error', error: msg });
          return { status: 'error', session: preSession, error: msg };
        }

        let hydrated = null;
        try {
          hydrated = await buildSupabaseSession(data.session.user, { throwOnSuspended: true });
        } catch (err) {
          const msg = mapOAuthErrorMessage({
            rawMessage: err instanceof Error ? err.message : null,
          });
          processedOAuthCallbacks.set(cacheKey, { status: 'error', error: msg });
          return { status: 'error', session: null, error: msg };
        }

        if (!hydrated) {
          try {
            await client.auth.signOut();
          } catch {
            // Ignore secondary signOut failure
          }
          const msg = 'Your learner profile could not be initialized. Please try signing in again.';
          processedOAuthCallbacks.set(cacheKey, { status: 'error', error: msg });
          return { status: 'error', session: null, error: msg };
        }

        recoveryMode = false;
        processedOAuthCallbacks.set(cacheKey, { status: 'authenticated', error: null });
        return { status: 'authenticated', session: hydrated, error: null };
      } finally {
        localAuthPendingCount = Math.max(0, localAuthPendingCount - 1);
      }
    }

    stripRecoveryParamsFromUrl();
    const session = await getCurrentSession();
    if (session) {
      recoveryMode = false;
      return { status: 'authenticated', session, error: null };
    }

    return {
      status: 'missing_callback',
      session: null,
      error: 'No Google sign-in response was found. Start sign-in again from the login page.',
    };
  }

  /** @returns {Promise<import('../../types/kord.d.ts').RecoveryState>} */
  async function resolvePasswordRecoverySession() {
    const cb = parseRecoveryCallbackFromUrl();

    if (cb.error || cb.errorCode || cb.errorDescription) {
      stripRecoveryParamsFromUrl();
      const existingSession = await getCurrentSession();
      return {
        status: 'invalid_link',
        session: existingSession,
        error: mapRecoveryErrorMessage(cb),
      };
    }

    if (cb.tokenHash) {
      const cacheKey = `token_hash:${cb.tokenHash}`;
      stripRecoveryParamsFromUrl();

      const cached = processedRecoveryCallbacks.get(cacheKey);
      if (cached) {
        const session = await getCurrentSession();
        if (cached.status === 'ready' && session) {
          return { status: 'ready', session, error: null };
        }
        return {
          status: 'invalid_link',
          session,
          error: cached.error || mapRecoveryErrorMessage(),
        };
      }

      if (cb.type && cb.type !== 'recovery') {
        const msg = 'This link is not a valid password recovery link.';
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: await getCurrentSession(), error: msg };
      }

      const client = getSupabaseClient();
      const authApi = client
        ? /** @type {import('../../types/kord.d.ts').SupabaseAuthLike} */ (
            /** @type {unknown} */ (client.auth)
          )
        : null;
      if (!client || typeof authApi?.verifyOtp !== 'function') {
        const msg = 'This password reset link is invalid or cannot be verified in this environment.';
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: await getCurrentSession(), error: msg };
      }

      const existingSession = await getCurrentSession();
      const { data, error } = await authApi.verifyOtp({
        token_hash: cb.tokenHash,
        type: 'recovery',
      });
      if (error || !data?.session?.user) {
        const msg = mapRecoveryErrorMessage({ rawMessage: error?.message ?? null });
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: existingSession, error: msg };
      }

      recoveryMode = true;
      const hydrated = await buildSupabaseSession(data.session.user);
      if (!hydrated) {
        const msg = 'This account is unavailable or suspended. Contact an administrator.';
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: null, error: msg };
      }
      processedRecoveryCallbacks.set(cacheKey, { status: 'ready', error: null });
      return { status: 'ready', session: hydrated, error: null };
    }

    if (cb.code) {
      const cacheKey = `code:${cb.code}`;
      const cached = processedRecoveryCallbacks.get(cacheKey);
      if (cached) {
        stripRecoveryParamsFromUrl();
        const session = await getCurrentSession();
        if (cached.status === 'ready' && session) {
          return { status: 'ready', session, error: null };
        }
        return {
          status: 'invalid_link',
          session,
          error: cached.error || mapRecoveryErrorMessage(),
        };
      }

      const client = getSupabaseClient();
      if (!client) {
        stripRecoveryParamsFromUrl();
        const msg = 'This password reset link is invalid or cannot be verified in demo mode.';
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: await getCurrentSession(), error: msg };
      }

      const preSession = await getCurrentSession();
      const stillHasCode = Boolean(parseRecoveryCallbackFromUrl().code);

      if (!stillHasCode && preSession) {
        recoveryMode = true;
        processedRecoveryCallbacks.set(cacheKey, { status: 'ready', error: null });
        return { status: 'ready', session: preSession, error: null };
      }

      const authApi = /** @type {import('../../types/kord.d.ts').SupabaseAuthLike} */ (
        /** @type {unknown} */ (client.auth)
      );
      if (typeof authApi?.exchangeCodeForSession !== 'function') {
        stripRecoveryParamsFromUrl();
        const msg = 'Password recovery code exchange is unavailable.';
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: preSession, error: msg };
      }

      const { data, error } = cb.flowId
        ? await authApi.exchangeCodeForSession(cb.code, { flowId: cb.flowId })
        : await authApi.exchangeCodeForSession(cb.code);
      stripRecoveryParamsFromUrl();

      if (error || !data?.session?.user) {
        const msg = mapRecoveryErrorMessage({
          rawMessage: error?.message || 'Invalid or expired recovery code.',
        });
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: preSession, error: msg };
      }

      recoveryMode = true;
      const hydrated = await buildSupabaseSession(data.session.user);
      if (!hydrated) {
        const msg = 'This account is unavailable or suspended. Contact an administrator.';
        processedRecoveryCallbacks.set(cacheKey, { status: 'invalid_link', error: msg });
        return { status: 'invalid_link', session: null, error: msg };
      }

      processedRecoveryCallbacks.set(cacheKey, { status: 'ready', error: null });
      return { status: 'ready', session: hydrated, error: null };
    }

    const session = await getCurrentSession();
    if (cb.type === 'recovery') {
      stripRecoveryParamsFromUrl();
      if (session) {
        recoveryMode = true;
        return { status: 'ready', session, error: null };
      }
      return {
        status: 'invalid_link',
        session: null,
        error: 'This password reset link is invalid, expired, or incomplete. Request a new reset link.',
      };
    }

    if (session) {
      return { status: 'ready', session, error: null };
    }

    return { status: 'missing_session', session: null, error: null };
  }

  /** @param {string} newPassword */
  async function updatePassword(newPassword) {
    const cleanPassword = String(newPassword || '');
    if (cleanPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    if (cleanPassword.length > 128) {
      throw new Error('Password must be 128 characters or fewer.');
    }

    const client = getSupabaseClient();
    if (client) {
      const { data: sessionData, error: sessionErr } = await client.auth.getSession();
      if (sessionErr || !sessionData?.session?.user) {
        throw new Error('Active password recovery or authenticated session required.');
      }
      const { error } = await client.auth.updateUser({ password: cleanPassword });
      if (error) throw new Error(error.message);
      recoveryMode = false;
      stripRecoveryParamsFromUrl();
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

  /**
   * @param {{ firstName?: string; fullName?: string; role?: string }} profile
   * @returns {Promise<Omit<import('../../types/kord.d.ts').KordUser, 'accountStatus'> | null>}
   */
  async function updateOwnProfile({ firstName, fullName, role }) {
    if (role !== undefined) {
      throw new Error('Profile roles cannot be modified by users.');
    }

    const cleanFirst = String(firstName || '').trim();
    const cleanFull = String(fullName || '').trim();

    const client = getSupabaseClient();
    if (client) {
      const { data: sessionData, error: sessionErr } = await client.auth.getSession();
      if (sessionErr || !sessionData.session) {
        throw new Error('Authentication required.');
      }
      const uid = sessionData.session.user.id;
      const { data, error } = await client
        .from('profiles')
        .update({
          first_name: cleanFirst,
          full_name: cleanFull,
        })
        .eq('id', uid)
        .select('id, email, first_name, full_name, role')
        .single();
      if (error) throw new Error(error.message);
      const updated = /** @type {Record<string, unknown>} */ (data || {});
      return {
        id: String(updated.id || uid),
        email: String(updated.email || ''),
        firstName: String(updated.first_name || ''),
        fullName: String(updated.full_name || ''),
        role: updated.role === 'admin' ? 'admin' : 'learner',
      };
    }

    const currentUserId = demoStore.getDemoCurrentUserId();
    if (!currentUserId) {
      throw new Error('Authentication required.');
    }

    /** @type {Omit<import('../../types/kord.d.ts').KordUser, 'accountStatus'> | null} */
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

    const client = getSupabaseClient();
    if (client) {
      localAuthPendingCount += 1;
      try {
        await client.auth.signOut();
      } finally {
        localAuthPendingCount = Math.max(0, localAuthPendingCount - 1);
      }
      return;
    }

    demoStore.setDemoCurrentUserId(null);
  }

  function isPasswordRecoveryMode() {
    return recoveryMode;
  }

  /**
   * @param {(payload: import('../../types/kord.d.ts').AuthChangePayload) => void} listener
   * @returns {() => void}
   */
  function subscribeAuthChanges(listener) {
    if (typeof listener !== 'function') return () => {};

    const client = getSupabaseClient();
    if (client) {
      let active = true;
      let eventSeq = 0;

      const { data } = client.auth.onAuthStateChange((event, rawSession) => {
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
            const cb = parseRecoveryCallbackFromUrl();
            if (!(cb.hasAccessToken && cb.type === 'recovery')) {
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
    signInWithGoogle,
    resolveOAuthCallback,
    recoverPassword,
    requestPasswordReset,
    resolvePasswordRecoverySession,
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
export const signInWithGoogle = defaultAuthService.signInWithGoogle;
export const resolveOAuthCallback = defaultAuthService.resolveOAuthCallback;
export const recoverPassword = defaultAuthService.recoverPassword;
export const requestPasswordReset = defaultAuthService.requestPasswordReset;
export const resolvePasswordRecoverySession = defaultAuthService.resolvePasswordRecoverySession;
export const updatePassword = defaultAuthService.updatePassword;
export const updateOwnProfile = defaultAuthService.updateOwnProfile;
export const signOut = defaultAuthService.signOut;
export const isPasswordRecoveryMode = defaultAuthService.isPasswordRecoveryMode;
export const subscribeAuthChanges = defaultAuthService.subscribeAuthChanges;

// =========================================================================
// Protected Admin User Governance & Audit History APIs
// =========================================================================
/** @returns {Promise<Omit<import('../../types/kord.d.ts').KordUser, 'password' | 'lastName'>[]>} */
export async function adminListUsers() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_list_users');
    if (error) throw new Error(error.message);
    return (/** @type {Record<string, unknown>[]} */ (data || [])).map((u) => ({
      id: String(u.id || ''),
      email: String(u.email || ''),
      firstName: String(u.first_name || ''),
      fullName: String(u.full_name || ''),
      role: u.role === 'admin' ? 'admin' : 'learner',
      accountStatus: u.account_status === 'suspended' ? 'suspended' : 'active',
      createdAt: u.created_at ? String(u.created_at) : undefined,
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
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
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

/**
 * @param {{
 *   targetUserId: string;
 *   newStatus: import('../../types/kord.d.ts').AccountStatus;
 *   reason?: string;
 *   actorId?: string | null;
 * }} opts
 */
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

  /** @type {Omit<import('../../types/kord.d.ts').KordUser, 'password' | 'lastName'> | null} */
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

/** @param {{ limit?: number }} [opts] */
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

