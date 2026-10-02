export function createLifecycleTaskRunner() {
  const failures: Array<{ task: string; error: string }> = [];
  return {
    failures,
    async run<T>(task: string, operation: () => Promise<T>, fallback: T): Promise<T> {
      try { return await operation(); }
      catch (error) {
        failures.push({ task, error: error instanceof Error ? error.message : String(error) });
        return fallback;
      }
    },
  };
}
