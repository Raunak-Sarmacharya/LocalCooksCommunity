import { describe, expect, it } from 'vitest';
import { authReturn, managerAuthReturn } from './auth-return';
import { postTermsRedirect } from './post-terms-redirect';

describe('post-confirmation login continuity', () => {
  it.each(['/booking/10?visit=2#checkout', '/dashboard?view=viewings&viewing=42',
    '/dashboard?view=support', '/manager/booking/10?visit=2#review',
    '/manager/dashboard?view=viewings&viewing=42', '/dashboard?view=messages&conversation=thread&booking=10',
    '/manager/dashboard?view=messages&conversation=thread&booking=10',
    '/dashboard?view=messages&conversation=original&tour=20', '/manager/dashboard?view=messages&conversation=original&tour=20'])('preserves action context through login and terms: %s', path => {
    expect(authReturn(path)).toBe(path);
    expect(postTermsRedirect({ hostname: 'chef.localhost', redirectParam: path, role: 'chef' })).toBe(path);
  });
  it.each(['https://other.test', '//other.test', '/\\other.test', '/%2fother.test', '/%5cother.test', '/auth', '/manager/login', '/accept-terms'])('rejects unsafe or looping return: %s', value => {
    expect(authReturn(value)).toBe('/');
    expect(managerAuthReturn(value)).toBe('/manager/dashboard');
  });
  it('keeps a manager on the manager surface', () => {
    expect(managerAuthReturn('/booking/10')).toBe('/manager/dashboard');
    expect(managerAuthReturn('/manager/booking/10?visit=2#review')).toBe('/manager/booking/10?visit=2#review');
  });
});
