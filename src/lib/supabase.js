import { createClient } from '@supabase/supabase-js';

function detectNodeTestRuntime() {
  try {
    if (import.meta.env?.MODE === 'test') {
      return true;
    }
    const nodeProcess = typeof globalThis !== 'undefined' ? globalThis.process : undefined;
    return Boolean(
      nodeProcess?.env &&
        (nodeProcess.env.NODE_TEST_CONTEXT || nodeProcess.env.NODE_ENV === 'test')
    );
  } catch {
    return false;
  }
}

/**
 * @param {{ env?: Record<string, unknown>; isNodeTest?: boolean }} [opts]
 */
export function resolveSupabaseRuntimeConfig({
  env = import.meta.env || {},
  isNodeTest = detectNodeTestRuntime(),
} = {}) {
  const supabaseUrl = String(env?.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(env?.VITE_SUPABASE_ANON_KEY || '').trim();
  const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);
  const isProdBuild = Boolean(env?.PROD) && !isNodeTest;
  const allowDemoMode = String(env?.VITE_ALLOW_DEMO_MODE || '').toLowerCase() === 'true';

  const isDemoMode = hasSupabaseEnv
    ? false
    : isNodeTest
      ? true
      : !isProdBuild && allowDemoMode;

  let supabaseConfigError = null;
  if (!hasSupabaseEnv && isProdBuild) {
    supabaseConfigError =
      'Supabase configuration is required in production. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before deploying.';
  } else if (!hasSupabaseEnv && !isDemoMode) {
    supabaseConfigError =
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment, or set VITE_ALLOW_DEMO_MODE=true for local development.';
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    hasSupabaseEnv,
    isProdBuild,
    allowDemoMode,
    isDemoMode,
    supabaseConfigError,
  };
}

const runtimeConfig = resolveSupabaseRuntimeConfig();

export const hasSupabaseEnv = runtimeConfig.hasSupabaseEnv;
export const isProdBuild = runtimeConfig.isProdBuild;
export const isDemoMode = runtimeConfig.isDemoMode;
export const supabaseConfigError = runtimeConfig.supabaseConfigError;

const APPROVED_LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const APPROVED_AISTUDIO_ORIGINS = [
  'https://ais-dev-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app',
  'https://ais-pre-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app',
];

const DEFAULT_PRODUCTION_ORIGIN = 'https://kord-lcec.vercel.app';

const APPROVED_AUTH_CALLBACK_PATHS = new Set(['/reset-password', '/auth/callback']);

/** @param {unknown} rawOrigin */
export function normalizeApprovedOrigin(rawOrigin) {
  const value = String(rawOrigin || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname && parsed.pathname !== '/') return null;
    if (parsed.search || parsed.hash) return null;

    const isLocalHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    const isHttps = parsed.protocol === 'https:';
    if (!isHttps && !isLocalHttp) return null;

    return parsed.origin;
  } catch {
    return null;
  }
}

/** @param {{ env?: Record<string, unknown> }} [opts] */
export function getAllowedAuthOrigins({ env = import.meta.env || {} } = {}) {
  const allowed = new Set([
    ...APPROVED_LOCAL_ORIGINS,
    ...APPROVED_AISTUDIO_ORIGINS,
    DEFAULT_PRODUCTION_ORIGIN,
  ]);
  const nodeEnv = typeof globalThis !== 'undefined' ? globalThis.process?.env : undefined;
  const configuredSiteUrl = normalizeApprovedOrigin(
    env?.VITE_SITE_URL || nodeEnv?.VITE_SITE_URL || ''
  );
  if (configuredSiteUrl) {
    allowed.add(configuredSiteUrl);
  }
  return allowed;
}

/**
 * @param {string} targetPath
 * @param {{ env?: Record<string, unknown>; currentOrigin?: string }} [opts]
 */
export function resolveAuthRedirectUrl(
  targetPath,
  { env = import.meta.env || {}, currentOrigin } = {}
) {
  const cleanPath = String(targetPath || '').trim();
  if (!APPROVED_AUTH_CALLBACK_PATHS.has(cleanPath)) {
    throw new Error('Unsupported authentication redirect path.');
  }

  const devOrigins = new Set([...APPROVED_LOCAL_ORIGINS, ...APPROVED_AISTUDIO_ORIGINS]);
  const allowedOrigins = getAllowedAuthOrigins({ env });
  const nodeEnv = typeof globalThis !== 'undefined' ? globalThis.process?.env : undefined;
  const configuredProdOrigin = normalizeApprovedOrigin(
    env?.VITE_SITE_URL || nodeEnv?.VITE_SITE_URL || ''
  );

  const rawCurrentOrigin =
    currentOrigin !== undefined
      ? currentOrigin
      : typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '';
  const normalizedCurrentOrigin = normalizeApprovedOrigin(rawCurrentOrigin);

  let resolvedOrigin;
  if (normalizedCurrentOrigin && devOrigins.has(normalizedCurrentOrigin)) {
    resolvedOrigin = normalizedCurrentOrigin;
  } else if (configuredProdOrigin) {
    resolvedOrigin = configuredProdOrigin;
  } else if (normalizedCurrentOrigin && allowedOrigins.has(normalizedCurrentOrigin)) {
    resolvedOrigin = normalizedCurrentOrigin;
  } else if (env?.PROD) {
    resolvedOrigin = DEFAULT_PRODUCTION_ORIGIN;
  } else {
    resolvedOrigin = 'http://localhost:3000';
  }

  return `${resolvedOrigin}${cleanPath}`;
}

export const supabase = hasSupabaseEnv
  ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey, {
      auth: {
        storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
        storageKey: 'kord-auth',
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;


