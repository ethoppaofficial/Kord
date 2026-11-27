/**
 * @param {import('../types/kord.d.ts').RouteDefinition[]} routes
 * @param {string} pathname
 */
export function matchRoute(routes, pathname) {
  const cleanPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  const pathParts = cleanPath.split('/').filter(Boolean);

  for (const route of routes) {
    const routeParts = route.pattern.split('/').filter(Boolean);
    if (routeParts.length !== pathParts.length) continue;

    /** @type {Record<string, string>} */
    const params = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (routeParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { route, params, path: cleanPath };
    }
  }

  return null;
}
