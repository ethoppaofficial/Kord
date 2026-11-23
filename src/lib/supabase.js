import { createClient } from '@supabase/supabase-js';

function detectNodeTestRuntime() {
  try {
    return Boolean(
      typeof process !== 'undefined' &&
        process?.env &&
        (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test')
    );
  } catch {
    return false;
  }
}

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

export const supabase = hasSupabaseEnv
  ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey, {
      auth: {
        storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
        storageKey: 'kord-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

