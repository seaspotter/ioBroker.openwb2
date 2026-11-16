/*
 * The persisted, human-editable record of which component IDs are known and enabled - the single
 * source of truth behind the admin UI's Components tab (admin/src/components/ComponentsTab.tsx) and
 * which objects main.ts creates at startup. Stored as JSON in native.componentTable.
 *
 * This module has no dependency on @iobroker/adapter-core so it can be imported from the admin
 * React bundle as well as from the backend (see admin/tsconfig.json's include of this file's
 * directory) - same pattern as iobroker.meterops' lib/registry-json.ts.
 */

import { COMPONENT_TYPES, emptyComponentIds, type ComponentType, type ComponentIds } from './constants';

export interface ComponentTableRow {
    type: ComponentType;
    id: number;
    enabled: boolean;
    /**
     * User-supplied display name, used as the component's channel name in the object tree.
     * openWB only exposes a configured name over MQTT for chargepoints (config/name, mirrored
     * under openWB/simpleAPI/#) - counter/battery/pv/consumer have no name anywhere in that
     * namespace, so this is the only way to get a human-readable name for those types.
     */
    name?: string;
}

function isComponentType(value: unknown): value is ComponentType {
    return typeof value === 'string' && (COMPONENT_TYPES as readonly string[]).includes(value);
}

function isValidRow(value: unknown): value is ComponentTableRow {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const row = value as Record<string, unknown>;
    return isComponentType(row.type) && typeof row.id === 'number' && Number.isFinite(row.id) && row.id >= 0;
}

/**
 * Parses native.componentTable. Never throws - malformed/empty/missing input just yields no rows,
 * since a config value can be edited by hand or come from an older adapter version.
 *
 * @param raw - raw native.componentTable value
 */
export function parseComponentTable(raw: string | undefined): ComponentTableRow[] {
    if (!raw) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter(isValidRow).map(row => ({
            type: row.type,
            id: row.id,
            enabled: row.enabled !== false,
            name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name : undefined,
        }));
    } catch {
        return [];
    }
}

/**
 * @param rows - table rows to serialize
 */
export function serializeComponentTable(rows: ComponentTableRow[]): string {
    return JSON.stringify(rows);
}

/**
 * Builds the enabled-only ComponentIds object creation needs, from the table's current rows.
 *
 * @param rows - parsed component table
 */
export function enabledIdsByType(rows: ComponentTableRow[]): ComponentIds {
    const ids = emptyComponentIds();
    for (const row of rows) {
        if (row.enabled) {
            ids[row.type].push(row.id);
        }
    }
    for (const type of COMPONENT_TYPES) {
        ids[type].sort((a, b) => a - b);
    }
    return ids;
}

/**
 * Unions two ComponentIds sets, e.g. a persistent MqttReader's already-observed IDs and a
 * short-lived probe's freshly-collected ones (see probeMqttComponents in mqttReader.ts) - either
 * source alone might miss an ID the other caught (a persistent connection that's seen it over time
 * vs. a fresh probe against a not-yet-connected host).
 *
 * @param a - first set
 * @param b - second set
 */
export function mergeComponentIds(a: ComponentIds, b: ComponentIds): ComponentIds {
    const merged = emptyComponentIds();
    for (const type of COMPONENT_TYPES) {
        merged[type] = [...new Set([...a[type], ...b[type]])].sort((x, y) => x - y);
    }
    return merged;
}

/**
 * Adds a new, disabled row for every discovered (type, id) not already in the table; never
 * touches or removes an existing row. Disabled by default - enabling is the user's own choice in
 * the Components tab, not something discovery does on its own.
 *
 * @param rows - existing table rows
 * @param discovered - freshly discovered component IDs, e.g. from MqttReader.getObservedIds()
 */
export function mergeDiscovered(
    rows: ComponentTableRow[],
    discovered: ComponentIds,
): { rows: ComponentTableRow[]; added: { type: ComponentType; id: number }[] } {
    const known = new Set(rows.map(row => `${row.type}:${row.id}`));
    const added: { type: ComponentType; id: number }[] = [];
    const newRows: ComponentTableRow[] = [];

    for (const type of COMPONENT_TYPES) {
        for (const id of discovered[type]) {
            const key = `${type}:${id}`;
            if (!known.has(key)) {
                known.add(key);
                newRows.push({ type, id, enabled: false });
                added.push({ type, id });
            }
        }
    }

    return { rows: [...rows, ...newRows], added };
}
