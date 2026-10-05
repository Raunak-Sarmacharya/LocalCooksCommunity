/** Preserve local action context through existing login and terms gates. */
export function authReturn(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020]/.test(decoded) || decoded.startsWith('//')) return fallback;
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || /^\/(auth|manager\/login|accept-terms)(\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function managerAuthReturn(value: string | null | undefined): string {
  const path = authReturn(value, '/manager/dashboard');
  return path.startsWith('/manager/') ? path : '/manager/dashboard';
}

export function adminAuthReturn(value: string | null | undefined): string {
  const path = authReturn(value, '/admin');
  const pathname = new URL(path, 'https://local.invalid').pathname;
  return (pathname === '/admin' || pathname.startsWith('/admin/')) && !/^\/admin\/login(\/|$)/.test(decodeURIComponent(pathname))
    ? path : '/admin';
}
