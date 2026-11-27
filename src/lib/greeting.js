const TZ_CACHE_KEY = 'kord_ip_tz_v1';
const TZ_CACHE_TTL_MS = 30 * 60 * 1000;

const HONORIFIC_PATTERN = /^(mr|mrs|ms|miss|mx|dr|prof|eng|engr|sir|chief)\.?$/i;

/** @typedef {{ timezone: string; city: string; country: string; source: 'ip' | 'browser'; cachedAt?: number }} TimezoneInfo */

/** @type {Promise<TimezoneInfo> | null} */
let inFlightTzPromise = null;

/**
 * @param {unknown} fullName
 * @param {string} [fallback]
 */
export function extractFirstName(fullName, fallback = 'there') {
  const clean = String(fullName || '').trim();
  if (!clean) return fallback;
  const parts = clean.split(/\s+/);
  if (parts.length >= 2 && HONORIFIC_PATTERN.test(parts[0])) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

/** @param {unknown} tz @returns {tz is string} */
function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function readCachedTimezone() {
  try {
    const raw = sessionStorage.getItem(TZ_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Date.now() - Number(parsed.cachedAt || 0) < TZ_CACHE_TTL_MS &&
      isValidTimeZone(parsed.timezone)
    ) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

/** @param {TimezoneInfo} info */
function writeCachedTimezone(info) {
  try {
    sessionStorage.setItem(
      TZ_CACHE_KEY,
      JSON.stringify({ ...info, cachedAt: Date.now() })
    );
  } catch {
    // ignore storage errors
  }
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, any> | null>}
 */
async function fetchJsonWithTimeout(url, timeoutMs = 2200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveIpTimezone() {
  const cached = readCachedTimezone();
  if (cached) return cached;

  if (inFlightTzPromise) return inFlightTzPromise;

  inFlightTzPromise = (async () => {
    // Primary IP geolocation lookup
    const ipapi = await fetchJsonWithTimeout('https://ipapi.co/json/', 2200);
    if (ipapi && isValidTimeZone(ipapi.timezone)) {
      /** @type {TimezoneInfo} */
      const info = {
        timezone: ipapi.timezone,
        city: String(ipapi.city || ''),
        country: String(ipapi.country_name || ''),
        source: 'ip',
      };
      writeCachedTimezone(info);
      return info;
    }

    // Secondary IP geolocation fallback
    const ipwho = await fetchJsonWithTimeout('https://ipwho.is/', 2200);
    const ipwhoTz = typeof ipwho?.timezone === 'object' && ipwho?.timezone ? ipwho.timezone.id : undefined;
    if (ipwho && ipwho.success !== false && isValidTimeZone(ipwhoTz)) {
      /** @type {TimezoneInfo} */
      const info = {
        timezone: ipwhoTz,
        city: String(ipwho.city || ''),
        country: String(ipwho.country || ''),
        source: 'ip',
      };
      writeCachedTimezone(info);
      return info;
    }

    // Graceful browser timezone fallback if IP endpoints are unreachable
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fallbackTz = isValidTimeZone(browserTz) ? browserTz : 'UTC';
    return /** @type {TimezoneInfo} */ ({
      timezone: fallbackTz,
      city: '',
      country: '',
      source: 'browser',
    });
  })().finally(() => {
    inFlightTzPromise = null;
  });

  return inFlightTzPromise;
}

/**
 * @param {string} timezone
 * @param {Date} [date]
 */
export function getTimePeriodForTimezone(timezone, date = new Date()) {
  const safeTz = isValidTimeZone(timezone) ? timezone : 'UTC';
  let hour = date.getHours();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const parsedHour = Number(hourPart);
    if (!Number.isNaN(parsedHour)) {
      hour = parsedHour === 24 ? 0 : parsedHour;
    }
  } catch {
    // fallback to local Date hour
  }

  let localTime;
  try {
    localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    localTime = '';
  }

  if (hour >= 5 && hour < 12) {
    return { period: 'morning', greeting: 'Good morning', hour, localTime };
  }
  if (hour >= 12 && hour < 17) {
    return { period: 'afternoon', greeting: 'Good afternoon', hour, localTime };
  }
  return { period: 'evening', greeting: 'Good evening', hour, localTime };
}

/** @param {Partial<import('../types/kord.d.ts').KordUser> | null | undefined} user */
export async function buildUserGreeting(user) {
  const firstName =
    String(user?.firstName || '').trim() ||
    extractFirstName(user?.fullName, user?.email?.split('@')[0] || 'there');

  const tzInfo = await resolveIpTimezone();
  const { period, greeting, localTime } = getTimePeriodForTimezone(tzInfo.timezone);

  return {
    text: `${greeting}, ${firstName}`,
    greeting,
    firstName,
    period,
    timezone: tzInfo.timezone,
    city: tzInfo.city,
    country: tzInfo.country,
    localTime,
    source: tzInfo.source,
  };
}
