import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = 'docs/phase-progress/evidence';
const checks = [
  ['client', ['node_modules/vitest/vitest.mjs', 'run', 'client/src/components/manager/ViewingsDashboard.test.tsx', 'client/src/components/manager/ViewingSettingsPanel.test.tsx', 'client/src/components/manager/settings/KitchensManagement.test.tsx', 'client/src/components/tour-a-auth-shell.test.tsx', 'client/src/components/tour-a-consumers.test.tsx', 'client/src/components/tour-b-consumers.test.tsx', '--maxWorkers=2']],
  ['attendance', ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.config.server.ts', 'shared/tour-attendance.test.ts', 'server/routes/viewings-lifecycle.test.ts', 'server/services/tour-delivery-service.test.ts', '--maxWorkers=2']],
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['project', ['node_modules/typescript/bin/tsc', '-b']],
  ['build', ['node_modules/vite/bin/vite.js', 'build']],
];
let failed = false;
const requested = new Set(process.argv.slice(2));
for (const [name, args] of checks) {
  if (requested.size && !requested.has(name)) continue;
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SENTRY_AUTH_TOKEN: '' }, maxBuffer: 20 * 1024 * 1024 });
  const output = `Command: Node ${args.join(' ')}\nEXIT ${result.status}\n${result.stdout || ''}${result.stderr || ''}${result.error || ''}`;
  fs.writeFileSync(`${root}/tour-page-${name}.log`, output);
  console.log(`${name}: exit ${result.status}`);
  if (result.status !== 0) { failed = true; console.log(output.slice(-12000)); }
}
process.exitCode = failed ? 1 : 0;
