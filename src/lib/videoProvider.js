import { escapeHtml } from './formatters.js';

/**
 * Provider-based external video registry.
 * Stores metadata + validated provider video IDs only; never accepts raw iframe HTML
 * and never duplicates external video binaries.
 */
const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export const VIDEO_PROVIDERS = {
  youtube: {
    key: 'youtube',
    label: 'YouTube',
    parseUrl(rawUrl) {
      if (!rawUrl || typeof rawUrl !== 'string') return { valid: false, error: 'Enter a valid YouTube URL.' };
      const trimmed = rawUrl.trim();
      if (trimmed.includes('<') || trimmed.includes('>')) {
        return { valid: false, error: 'HTML or iframe tags are not allowed. Paste a standard YouTube link.' };
      }

      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        return { valid: false, error: 'Enter a complete URL starting with https://' };
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { valid: false, error: 'Only HTTP/HTTPS video URLs are supported.' };
      }

      const host = parsed.hostname.toLowerCase();
      if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
        return { valid: false, error: 'URL host is not in the supported YouTube domain allowlist.' };
      }

      let videoId = '';
      if (host.includes('youtu.be')) {
        videoId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      } else if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v') || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/embed/')[1]?.split('/')[0] || '';
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/shorts/')[1]?.split('/')[0] || '';
      } else if (parsed.pathname.startsWith('/live/')) {
        videoId = parsed.pathname.split('/live/')[1]?.split('/')[0] || '';
      }

      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return { valid: false, error: 'Could not extract a valid 11-character YouTube video ID.' };
      }

      return {
        valid: true,
        provider: 'youtube',
        videoId,
        originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
      };
    },
    buildEmbedUrl(videoId) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return null;
      return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
    },
    buildWatchUrl(videoId) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return '';
      return `https://www.youtube.com/watch?v=${videoId}`;
    },
  },
};

export function listSupportedVideoProviders() {
  return Object.values(VIDEO_PROVIDERS).map((p) => ({ key: p.key, label: p.label }));
}

export function normalizeVideoEntry(input) {
  const providerKey = input?.provider || 'youtube';
  const adapter = VIDEO_PROVIDERS[providerKey];
  if (!adapter) {
    return { valid: false, error: `Unsupported video provider: ${providerKey}` };
  }

  let videoId = input?.videoId || '';
  let originalUrl = input?.url || input?.originalUrl || '';
  if (!videoId && originalUrl) {
    const parsed = adapter.parseUrl(originalUrl);
    if (!parsed.valid) return parsed;
    videoId = parsed.videoId;
    originalUrl = parsed.originalUrl;
  } else if (originalUrl) {
    const parsed = adapter.parseUrl(originalUrl);
    if (!parsed.valid) return parsed;
    videoId = parsed.videoId;
    originalUrl = parsed.originalUrl;
  }

  const embedUrl = adapter.buildEmbedUrl(videoId);
  if (!embedUrl) {
    return { valid: false, error: 'Missing valid video identifier.' };
  }

  return {
    valid: true,
    video: {
      id: input?.id || `vid-${videoId}`,
      provider: providerKey,
      videoId,
      title: String(input?.title || 'Lesson Video').trim(),
      url: originalUrl || adapter.buildWatchUrl(videoId),
      embedUrl,
      description: String(input?.description || '').trim(),
      duration: String(input?.duration || '').trim(),
      transcript: String(input?.transcript || '').trim(),
      viewingInstructions: String(input?.viewingInstructions || '').trim(),
      embedRestricted: Boolean(input?.embedRestricted),
    },
  };
}

export function renderVideoPlayerHtml(video, index = 0) {
  const adapter = VIDEO_PROVIDERS[video?.provider || 'youtube'];
  const embedUrl = video?.embedUrl || (adapter ? adapter.buildEmbedUrl(video?.videoId) : null);
  const watchUrl = video?.url || (adapter ? adapter.buildWatchUrl(video?.videoId) : '');
  const title = video?.title || `Video ${index + 1}`;
  const isRestricted = Boolean(video?.embedRestricted || !embedUrl);

  return `
    <div class="video-card" data-video-box="${escapeHtml(video?.id || String(index))}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <div class="meta-line" style="margin-bottom:2px;">
            <span>Embedded ${escapeHtml(adapter?.label || 'External')} Video</span>
            ${video?.duration ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num">${escapeHtml(video.duration)}</span>` : ''}
          </div>
          <h4 style="font-size:1rem;">${escapeHtml(title)}</h4>
        </div>
        ${
          watchUrl
            ? `<button type="button" class="btn btn-ghost btn-sm" data-video-fallback-toggle="${escapeHtml(video?.id || String(index))}">Playback help</button>`
            : ''
        }
      </div>

      ${video?.description ? `<p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:10px;">${escapeHtml(video.description)}</p>` : ''}

      ${
        video?.viewingInstructions
          ? `<div style="padding:10px 12px; border-radius:var(--radius-sm); background:var(--color-blue-soft); border:1px solid var(--color-blue-border); font-size:13px; color:var(--color-navy); margin-bottom:12px;">
              <strong>Viewing guide:</strong> ${escapeHtml(video.viewingInstructions)}
            </div>`
          : ''
      }

      ${
        isRestricted
          ? `
            <div class="state-box" style="padding:24px 16px;">
              <h4 style="font-size:0.95rem;">Embedded playback unavailable</h4>
              <p>This external video has embedding disabled, is private, or was removed by the publisher. Read the lesson text and transcript below to continue.</p>
              ${
                watchUrl
                  ? `<a href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Check video source</a>`
                  : ''
              }
            </div>
          `
          : `
            <div class="video-frame-wrap">
              <iframe
                src="${escapeHtml(embedUrl)}"
                title="${escapeHtml(title)}"
                loading="lazy"
                referrerpolicy="strict-origin-when-cross-origin"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
              ></iframe>
            </div>
            <div class="video-fallback-note" id="video-help-${escapeHtml(video?.id || String(index))}" style="display:none; margin-top:10px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--color-surface-subtle); border:1px solid var(--color-border); font-size:13px; color:var(--color-text-secondary);">
              If the player reports an unavailable or restricted video, the publisher may have disabled embedding. You can still study all lesson sections and transcript notes inside Kord, or
              ${watchUrl ? `<a href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer">open the source reference</a>.` : 'contact an administrator to refresh the video link.'}
            </div>
          `
      }

      ${
        video?.transcript
          ? `
            <details style="margin-top:12px; border-top:1px solid var(--color-border); padding-top:10px;">
              <summary style="cursor:pointer; font-size:13px; font-weight:600; color:var(--color-blue);">Read video transcript / key notes</summary>
              <p style="margin-top:8px; font-size:13px; color:var(--color-text-secondary); white-space:pre-line;">${escapeHtml(video.transcript)}</p>
            </details>
          `
          : ''
      }
    </div>
  `;
}
