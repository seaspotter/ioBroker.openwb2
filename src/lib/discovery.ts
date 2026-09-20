import { COMPONENT_TYPES, LIST_COMPONENTS_PARAM, type ComponentIds } from './constants';
import { enabledIdsByType, type ComponentTableRow } from './componentTable';
import type { SimpleApiClient, SimpleApiConnectionConfig } from './simpleApiClient';

export type { ComponentIds } from './constants';

export type DiscoverySource = 'list_components' | 'manual';

/** Result of a discovery run: the component IDs found, and which strategy produced them. */
export interface DiscoveryResult {
    ids: ComponentIds;
    source: DiscoverySource;
}

function emptyIds(): ComponentIds {
    return { chargepoint: [], counter: [], battery: [], pv: [], consumer: [], io: [] };
}

/**
 * Tries openWB's list_components=all endpoint (added by openWB/core PR #3981, not merged
 * upstream as of this writing). On a core without that PR, the param isn't in simpleapi.php's
 * read allow-list at all, so the request cleanly fails (HTTP 400) rather than returning partial
 * data - that failure is the signal to fall back to the component table.
 *
 * Exported directly (not just via discoverComponents()) for the admin UI's "Probe now" button and
 * the background rediscovery timer, both of which only ever care about the live list_components
 * result, never the component-table fallback.
 *
 * @param client - simpleAPI HTTP client
 * @param cfg - connection config
 */
export async function discoverViaListComponents(
    client: SimpleApiClient,
    cfg: SimpleApiConnectionConfig,
): Promise<ComponentIds | undefined> {
    const result = await client.read(cfg, { [LIST_COMPONENTS_PARAM]: 'all' });
    if (!result.ok) {
        return undefined;
    }

    const ids = emptyIds();
    let sawAnyType = false;
    for (const type of COMPONENT_TYPES) {
        const raw = result.data[type];
        if (Array.isArray(raw)) {
            sawAnyType = true;
            ids[type] = raw
                .map(Number)
                .filter(n => Number.isFinite(n) && n >= 0)
                .sort((a, b) => a - b);
        }
    }
    // A response that doesn't even look like {chargepoint: [...], ...} isn't a real
    // list_components response (e.g. some unrelated JSON on a heavily customized core) - treat as
    // unavailable rather than trusting an all-empty result.
    return sawAnyType ? ids : undefined;
}

/**
 * Discovers component IDs for startup/normal operation: tries list_components=all first, falls
 * back to the enabled rows of the persisted component table (native.componentTable, see
 * componentTable.ts) if that endpoint isn't available on this core. Bounded ID-range *probing*
 * was considered and rejected: every get*All handler in ParameterHandler.php reads via
 * MqttClient::getMultipleValues(), which never throws for a missing topic and instead returns
 * hard defaults (0, 'Unbekannt', ...) - a nonexistent ID and a real, idle device are
 * indistinguishable in the response, so there is no signal to probe for.
 *
 * @param client - simpleAPI HTTP client
 * @param cfg - connection config
 * @param tableRows - parsed component table, used only if list_components fails
 */
export async function discoverComponents(
    client: SimpleApiClient,
    cfg: SimpleApiConnectionConfig,
    tableRows: ComponentTableRow[],
): Promise<DiscoveryResult> {
    const viaListComponents = await discoverViaListComponents(client, cfg);
    if (viaListComponents) {
        return { ids: viaListComponents, source: 'list_components' };
    }
    return { ids: enabledIdsByType(tableRows), source: 'manual' };
}
