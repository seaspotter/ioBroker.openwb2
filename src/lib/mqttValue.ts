/**
 * Normalizes a raw MQTT payload string from `openWB/simpleAPI/#` (or the raw `openWB/io/#`
 * namespace) into a JS value. Verified against a real device's actual wire values (read-only
 * `mosquitto_sub` capture, not guessed): value encoding there is inconsistent, not uniformly
 * JSON -
 *   - numbers and `null` are plain and valid JSON as-is
 *   - some strings are properly JSON-encoded, e.g. `"Kein Fehler."` (with quotes)
 *   - other strings arrive bare/unquoted, e.g. `pv_charging`, `km`, even `Renault Megane` (a bare
 *     string containing a space)
 *   - booleans arrive as Python's `True`/`False` (capitalized) rather than JSON's `true`/`false`
 * This order handles every shape actually observed: try JSON.parse first (catches numbers, null,
 * quoted strings, and the rare lowercase true/false), map the Python-style capitalized booleans
 * explicitly, and fall back to the trimmed raw string for anything else (bare/unquoted strings).
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
