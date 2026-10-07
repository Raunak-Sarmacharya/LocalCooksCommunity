/** Shared delivery theme, independent of the application's display mode. */
export const emailBrandLogoUrl = 'https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader-brand-red.png';

const darkRules = `
body.lc-email{background:#171717 !important;color:#f5f5f4 !important}
.lc-email .email-container,.lc-email .lc-surface,.lc-email .header,.lc-email .footer,.lc-email .custom-header,.lc-email .custom-footer{background:#171717 !important;background-image:none !important;color:#f5f5f4 !important;box-shadow:none !important}
.lc-email .greeting,.lc-email .message,.lc-email .lc-text,.lc-email h1,.lc-email h2,.lc-email h3{color:#f5f5f4 !important}
.lc-email .header h1,.lc-email .header h2,.lc-email .header p,.lc-email .custom-header h1,.lc-email .custom-header h2,.lc-email .custom-header p{color:#f5f5f4 !important}
.lc-email .lc-muted,.lc-email .footer-text,.lc-email .footer-links{color:#bdb8b3 !important}
.lc-email .lc-panel,.lc-email .info-box,.lc-email .credentials-table td{background:#262626 !important;background-image:none !important;border-color:#525252 !important;color:#f5f5f4 !important}
.lc-email .lc-positive,.lc-email .status-badge.approved{background:#143322 !important;background-image:none !important;color:#bbf7d0 !important;border-color:#35774c !important}
.lc-email .lc-warning,.lc-email .warning-box{background:#382b15 !important;background-image:none !important;color:#fde68a !important;border-color:#a16207 !important}
.lc-email .lc-danger,.lc-email .status-badge.rejected{background:#3e1920 !important;background-image:none !important;color:#fecdd3 !important;border-color:#9f3450 !important}
.lc-email .lc-link,.lc-email a{color:#fda4af !important}
.lc-email .cta-button,.lc-email .lc-primary{background:#e11d48 !important;background-image:none !important;color:#ffffff !important;border-color:#e11d48 !important}
.lc-email .lc-on-accent{color:#ffffff !important}
.lc-email .email-footer,.lc-email .footer,.lc-email .lc-border,.lc-email h2{border-color:#525252 !important}
`;
export { darkRules as emailDarkRules };

const styles = `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style data-lc-email-theme="1">
:root{color-scheme:light dark;supported-color-schemes:light dark}
body.lc-email{background:#ffffff;color:#292524;overflow-wrap:anywhere}
.lc-email .header,.lc-email .footer,.lc-email .custom-header,.lc-email .custom-footer{background:#ffffff !important;background-image:none !important;color:#292524;text-align:left !important}
.lc-email .header h1,.lc-email .header h2,.lc-email .header p,.lc-email .custom-header h1,.lc-email .custom-header h2,.lc-email .custom-header p{color:#292524 !important}
.lc-email .header-image,.lc-email .email-logo,.lc-email .custom-header img{display:block;width:200px !important;max-width:100% !important;height:auto !important;margin-left:0 !important;background:transparent !important;border-radius:0}
.lc-email .email-container{box-sizing:border-box !important}
.lc-email h1,.lc-email .email-title{font-size:26px !important;line-height:1.25 !important;letter-spacing:-0.4px}
.lc-email h2,.lc-email .greeting{font-size:20px !important;line-height:1.35 !important}
.lc-email h3{font-size:18px !important;line-height:1.35 !important}
.lc-email .message{font-size:16px !important}
.lc-email .cta-button,.lc-email .lc-primary{background:#e11d48 !important;background-image:none !important;color:#ffffff !important;box-shadow:none !important}
.lc-email .lc-surface{background:#ffffff;color:#292524}
@media(prefers-color-scheme:dark){${darkRules}}
${darkRules.replace(/\.lc-email /g, '[data-ogsc] .lc-email ').replace(/body\.lc-email/g, '[data-ogsc] body.lc-email')}
@media only screen and (max-width:560px){.lc-email .content,.lc-email .header,.lc-email .footer{padding-left:24px !important;padding-right:24px !important}.lc-email .email-container{width:100% !important;border-radius:0 !important}.lc-email h1,.lc-email .email-title{font-size:24px !important}.lc-email h2,.lc-email .greeting{font-size:18px !important}}
</style>`;

function addClasses(attributes: string, classes: string[]) {
  if (!classes.length) return attributes;
  const existing = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i);
  return existing ? attributes.replace(existing[0], `class=${existing[1]}${existing[2]} ${classes.join(' ')}${existing[1]}`)
    : `${attributes} class="${classes.join(' ')}"`;
}

/** Annotate our existing inline palette so dark mode can override it without changing links or text. */
export function prepareEmailHtml(html: string): string;
export function prepareEmailHtml(html: undefined): undefined;
export function prepareEmailHtml(html: string | undefined): string | undefined;
export function prepareEmailHtml(html: string | undefined): string | undefined {
  if (!html || html.includes('data-lc-email-theme="1"')) return html;
  let themed = html.replace(/(<img\b[^>]*\bsrc=["'])https:\/\/raw\.githubusercontent\.com\/Raunak-Sarmacharya\/LocalCooksCommunity\/refs\/heads\/main\/attached_assets\/(?:emailHeader|Logo_LocalCooks)\.png(["'][^>]*>)/gi,
    `$1${emailBrandLogoUrl}$2`);
  if (!/<body\b/i.test(themed)) themed = `<!DOCTYPE html><html><head></head><body>${themed}</body></html>`;
  themed = themed.replace(/<([a-z][\w:-]*)\b([^<>]*?)>/gi, (tag, name: string, attributes: string) => {
    const classes: string[] = name.toLowerCase() === 'body' ? ['lc-email'] : [];
    const inline = attributes.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    const background = inline.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i)?.[1] || '';
    const backgroundHex = background.match(/#([\da-f]{6})\b/i)?.[1];
    const paleBackground = backgroundHex && (parseInt(backgroundHex.slice(0, 2), 16) * 0.299
      + parseInt(backgroundHex.slice(2, 4), 16) * 0.587 + parseInt(backgroundHex.slice(4, 6), 16) * 0.114) > 150;
    const colour = inline.match(/(?:^|;)\s*color\s*:\s*([^;!]+)/i)?.[1].trim().toLowerCase();
    if (/^#(?:fff(?:fff)?|ffffff)\b|^white\b/i.test(background)) classes.push('lc-surface');
    else if (/#f0fdf4|#dcfce7/.test(background)) classes.push('lc-positive');
    else if (/#fffbeb|#fef3c7/.test(background)) classes.push('lc-warning');
    else if (/#fef2f2|#fee2e2|#fff1f2/.test(background)) classes.push('lc-danger');
    else if (paleBackground) classes.push('lc-panel');
    if (name.toLowerCase() === 'a' && /#e11d48|#ff005c|hsl\(347/i.test(background)) classes.push('lc-primary');
    if (colour === '#ffffff' || colour === '#fff' || colour === 'white') classes.push('lc-on-accent');
    else if (colour && ['#57534e','#64748b','#94a3b8','#6b7280','#475569'].includes(colour)) classes.push('lc-muted');
    else if (colour) classes.push(name.toLowerCase() === 'a' ? 'lc-link' : 'lc-text');
    if (/(?:^|;)\s*border(?:-[\w-]+)?\s*:/i.test(inline)) classes.push('lc-border');
    return classes.length ? `<${name}${addClasses(attributes, classes)}>` : tag;
  });
  if (/<\/head\s*>/i.test(themed)) return themed.replace(/<\/head\s*>/i, `${styles}</head>`);
  return themed.replace(/<body\b/i, `<head>${styles}</head><body`);
}
