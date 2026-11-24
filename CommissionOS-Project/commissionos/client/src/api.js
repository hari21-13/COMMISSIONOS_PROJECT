// Thin fetch wrapper for the Express API. The JWT is kept in sessionStorage (per browser tab: opening the link fresh always shows the login); business data never is.
const BASE = (import.meta.env && import.meta.env.VITE_API_URL) || '/api';
const TOKEN_KEY = 'auron-commissionos:token';

export const tokenStore = {
  get: () => {
    try { return window.sessionStorage.getItem(TOKEN_KEY); } catch (err) { return null; }
  },
  set: (t) => {
    try { window.sessionStorage.setItem(TOKEN_KEY, t); } catch (err) { /* ignore */ }
  },
  clear: () => {
    try { window.sessionStorage.removeItem(TOKEN_KEY); window.localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/google', '/auth/confirm'];

async function request(method, path, body) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new ApiError(0, 'Cannot reach the server. Please check that the API is running.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (err) { /* non-JSON response */ }

  if (!res.ok) {
    if (res.status === 401 && token && !PUBLIC_AUTH_PATHS.some((p) => path.startsWith(p))) {
      window.dispatchEvent(new Event('auth-expired'));
    }
    throw new ApiError(res.status, (data && data.error) || res.statusText || 'Request failed');
  }
  return data;
}

export const api = {
  request,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body === undefined ? {} : body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};