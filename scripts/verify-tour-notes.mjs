import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = 'docs/phase-progress/evidence';
fs.mkdirSync(root, { recursive: true });
const checks = [
  ['server', ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.config.server.ts', 'server/routes/viewings-availability.test.ts', 'server/routes/viewings-lifecycle.test.ts', 'server/services/advance-reminders.test.ts', '--maxWorkers=2']],
  ['client', ['node_modules/vitest/vitest.mjs', 'run', 'client/src/components/manager/ViewingSettingsPanel.test.tsx', 'client/src/components/manager/settings/KitchensManagement.test.tsx', 'client/src/components/chef/ChefViewingsList.test.tsx', '--maxWorkers=2']],
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['project', ['node_modules/typescript/bin/tsc', '-b']],
  ['build', ['node_modules/vite/bin/vite.js', 'build']],
];
let failed = false;
for (const [name, args] of checks) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SENTRY_AUTH_TOKEN: '' }, maxBuffer: 20 * 1024 * 1024 });
  const output = `Command: Node ${args.join(' ')}\nEXIT ${result.status}\n${result.stdout || ''}${result.stderr || ''}${result.error || ''}`;
  fs.writeFileSync(`${root}/tour-notes-${name}.log`, output);
  console.log(`${name}: exit ${result.status}`);
  if (result.status !== 0) { failed = true; console.log(output.slice(-10000)); }
}
process.exitCode = failed ? 1 : 0;
