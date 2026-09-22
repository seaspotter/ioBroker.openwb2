/*
 * The persisted, human-editable record of which component IDs are known and enabled - the single
 * source of truth behind both the admin UI's Components tab (admin/src/components/ComponentsTab.tsx)
 * and the runtime discovery fallback (discovery.ts). Stored as JSON in native.componentTable.
 *
 * This module has no dependency on @iobroker/adapter-core so it can be imported from the admin
 * React bundle as well as from the backend (see admin/tsconfig.json's include of this file's
 * directory) - same pattern as iobroker.meterops' lib/registry-json.ts.
 */

import { COMPONENT_TYPES, type ComponentType, type ComponentIds } from './constants';

export interface ComponentTableRow {
    type: ComponentType;
    id: number;
    enabled: boolean;
    /**
     * User-supplied display name, used as the component's channel name in the object tree.
     * openWB only exposes a configured name over MQTT for chargepoints (config/name, mirrored
     * under openWB/simpleAPI/#) - counter/battery/pv/io have no name anywhere in that namespace,
     * so this is the only way to get a human-readable name for those types.
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
 * Builds the enabled-only ComponentIds the poll planner and object creation need, from the
 * table's current rows.
 *
 * @param rows - parsed component table
 */
export function enabledIdsByType(rows: ComponentTableRow[]): ComponentIds {
    const ids: ComponentIds = { chargepoint: [], counter: [], battery: [], pv: [], consumer: [], io: [] };
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
 * Merges freshly discovered component IDs into the existing table: adds a new, disabled row for
 * every (type, id) not already present as a row (regardless of that existing row's enabled
 * state), and never touches or removes any existing row. This is the whole answer to "how do we
 * know an ID was already there, and what happens when one disappears": the table's row set *is*
 * the "already known" record, discovery only ever proposes additions to it, and a row that a
 * fresh discovery no longer reports simply isn't touched - the caller can flag that in the UI
 * without this function needing to decide anything about it.
 *
 * New rows start disabled rather than enabled - discovery (whether a manual "Probe now" or the
 * background interval check) should only ever *propose* a component, never activate it on its
 * own. Enabling it (and thus creating its objects/starting to poll it) is the user's own explicit
 * choice, ticked in the Components tab and confirmed with Save.
 *
 * @param rows - existing table rows
 * @param discovered - freshly discovered component IDs, e.g. from a live list_components probe
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
