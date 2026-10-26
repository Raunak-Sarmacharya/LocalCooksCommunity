import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat notice Node/tsx module boundary', () => {
  it('imports the Functions CommonJS module by default export, as Node/tsx needs', () => {
    // Vitest bundles imports and hid the npm run dev named-export failure, so the real loader checks the boundary.
    // Only the CommonJS module itself is loaded: importing all of chat-notices.ts cold took ~6 s and timed out under load.
    const source = readFileSync('server/services/chat-notices.ts', 'utf8');
    expect(source).toMatch(/import chatNotice\b[^;]*from '\.\.\/\.\.\/functions\/src\/chat-notice';/);
    expect(source).not.toMatch(/import \{[^}]*\} from '\.\.\/\.\.\/functions\/src\/chat-notice'/);
    const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      'const m = (await import("./functions/src/chat-notice.ts")).default; for (const name of ["queueChatNotice", "resolveChatNoticeContext", "chatMessageForRecipient"]) if (typeof m?.[name] !== "function") throw Error(name + " unavailable"); process.stdout.write("CHAT_MODULE_READY");'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, NODE_ENV: 'test', E2E_SUPPRESS_OUTBOUND: '1', SENTRY_DSN: '' },
    });
    expect(result).toContain('CHAT_MODULE_READY');
  }, 25000);
});
