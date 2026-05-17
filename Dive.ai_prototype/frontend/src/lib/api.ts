const BASE = 'http://localhost:8000';

export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('jwt_token');
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${BASE}${path}`, { ...options, headers });
}
