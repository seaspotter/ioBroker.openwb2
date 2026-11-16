/**
 * Normalizes a raw MQTT payload into a JS value. Wire encoding is inconsistent (confirmed live):
 * numbers/null/quoted strings are valid JSON, bare strings aren't (`pv_charging`, `Renault Megane`),
 * and booleans arrive as Python's `True`/`False`. Tries JSON.parse first, maps `True`/`False`
 * explicitly, falls back to the trimmed raw string.
 *
 * @param raw - raw MQTT payload as a string
 */
export function normalizeMqttValue(raw: string): unknown {
    const trimmed = raw.trim();

    if (trimmed === 'True') {
        return true;
    }
    if (trimmed === 'False') {
        return false;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}
