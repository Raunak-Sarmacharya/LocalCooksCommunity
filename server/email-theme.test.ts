import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { prepareEmailHtml, emailBrandLogoUrl } from './email-theme';

describe('shared light/dark email delivery theme', () => {
  it('preserves literal content and action targets while replacing the old white logo', () => {
    const html = '<html><head><title>Kitchen &amp; tour</title></head><body><div class="header"><img alt="Local Cooks" src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png"></div><p style="color:#475569">Hi Олена &lt;chef&gt;</p><a href="https://chef.example.test/tour?id=42&amp;action=feedback" style="background:#e11d48;color:#ffffff">Share feedback</a><div style="\nbackground:#e0f2fe;\ncolor:#292524\n">Keep this detail</div></body></html>';
    const before = new JSDOM(html).window.document;
    const prepared = prepareEmailHtml(html);
    const after = new JSDOM(prepared).window.document;
    expect(after.body.textContent).toBe(before.body.textContent);
    expect(after.querySelector('a')!.getAttribute('href')).toBe(before.querySelector('a')!.getAttribute('href'));
    expect(after.querySelector('img')!.getAttribute('src')).toBe(emailBrandLogoUrl);
    expect(after.querySelector('img')!.getAttribute('alt')).toBe('Local Cooks');
    expect(after.querySelector('meta[name="color-scheme"]')!.getAttribute('content')).toBe('light dark');
    expect(prepared).toContain('prefers-color-scheme:dark');
    expect(prepared).toContain('[data-ogsc]');
    expect(after.querySelector('.lc-panel.lc-text')?.textContent).toBe('Keep this detail');
    expect(prepareEmailHtml(prepared)).toBe(prepared);
  });

  it('supports fragment emails and optional HTML without adding an action or changing text', () => {
    expect(prepareEmailHtml(undefined)).toBeUndefined();
    expect(prepareEmailHtml('')).toBe('');
    const document = new JSDOM(prepareEmailHtml('<p>Application received.</p>')).window.document;
    expect(document.body.textContent).toBe('Application received.');
    expect(document.querySelectorAll('a').length).toBe(0);
  });
});
