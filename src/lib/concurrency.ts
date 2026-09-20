/**
 * Runs `tasks` with at most `concurrency` running at once, preserving result order. Each poll
 * cycle's HTTP requests use this instead of either full-parallel (could overwhelm the openWB
 * device's webserver) or fully sequential (reintroduces the N-times-slow anti-pattern this
 * adapter's poll planner exists to avoid).
 *
 * @param tasks - functions to invoke, each returning a promise
 * @param concurrency - max number of tasks running at once (clamped to at least 1)
 */
export async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const limit = Math.max(1, Math.floor(concurrency) || 1);
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        for (;;) {
            const index = nextIndex++;
            if (index >= tasks.length) {
                return;
            }
            results[index] = await tasks[index]();
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    return results;
}
