import { describe, expect, it } from 'vitest';
import { createLifecycleTaskRunner } from './lifecycle-task-runner';
describe('lifecycle scheduler isolation', () => {
  it('records a failed task and still runs a later task', async () => {
    const runner = createLifecycleTaskRunner();
    expect(await runner.run('claims', async () => { throw new Error('database unavailable'); }, [])).toEqual([]);
    expect(await runner.run('checkout', async () => ({ cleared: 2 }), { cleared: 0 })).toEqual({ cleared: 2 });
    expect(runner.failures).toEqual([{ task: 'claims', error: 'database unavailable' }]);
  });
});
