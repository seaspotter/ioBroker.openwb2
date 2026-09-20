/** Runtime-checked readers for native config values, which arrive as `unknown` from ioBroker's admin state. */

/**
 * @param value - raw native config value
 * @param fallback - value to use if `value` isn't a string
 */
export function asString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

/**
 * @param value - raw native config value
 * @param fallback - value to use if `value` isn't a finite number
 */
export function asNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
