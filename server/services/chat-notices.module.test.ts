import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('chat notice Node/tsx module boundary', () => {
  it('loads the real portal module across the Functions CommonJS package boundary', () => {
    // Vitest bundles imports and hid the npm run dev named-export failure.
    // Use the actual Node/tsx loader, without connecting to a real database.
    const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      'const m = await import("./server/services/chat-notices.ts"); if (typeof m.dispatchChatDigests !== "function" || typeof m.notifyPersistedChatMessage !== "function") throw Error("Chat module unavailable"); process.stdout.write("CHAT_MODULE_READY");'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, NODE_ENV: 'test', E2E_SUPPRESS_OUTBOUND: '1', SENTRY_DSN: '',
        DATABASE_URL: 'postgres://module_test:module_test@127.0.0.1:1/module_test',
        DOTENV_CONFIG_PATH: './.module-test-no-env' },
    });
    expect(result).toContain('CHAT_MODULE_READY');
  }, 25000);
});
