export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { ...headers },
  };
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob || typeof body === 'string') options.body = body;
    else {
      options.body = JSON.stringify(body);
      options.headers['content-type'] = 'application/json';
    }
  }
  const response = await fetch(path, options);
  if (raw) {
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response;
  }
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { data = await response.json(); } catch { data = null; }
  } else {
    const text = await response.text();
    data = text;
  }
  if (!response.ok) {
    const message = data?.error?.message || (typeof data === 'string' && data.slice(0, 300)) || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: body ?? {} });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });

export function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...options }).format(date);
}
export function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: Math.abs(Number(value) || 0) >= 100000 ? 'compact' : 'standard' }).format(Number(value) || 0);
}
export function safeHref(url) {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
  } catch { return null; }
}
export function initials(name = '') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'FCL';
}
export function errorMessage(error) {
  return error?.message || String(error || 'Something went wrong.');
}
