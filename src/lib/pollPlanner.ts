import { ALL_READ_PARAM, COMPONENT_TYPES, type ComponentType } from './constants';
import type { ComponentIds } from './discovery';

/** One HTTP request's worth of a poll cycle, and which component instances it covers. */
export interface PollRequest {
    /** simpleapi.php read params for this request, e.g. {get_chargepoint_all: 0, battery: 0} */
    params: Record<string, string | number>;
    /** which component instances this request's response will contain, for routing the result */
    components: { type: ComponentType; id: number }[];
}

/**
 * Builds the minimal set of HTTP requests needed to read every discovered component once.
 *
 * simpleapi.php parses $_GET/$_POST as a flat associative array, so passing the same param key
 * twice (e.g. two `get_chargepoint_all` for two chargepoints) only keeps the last value - you
 * cannot fetch two instances of the *same* type in one request. Different types *can* share one
 * request, since each uses a distinct param key. So the minimum number of requests is
 * `max(count per type)`, each carrying at most one ID per type, assigned round-robin - not one
 * request per component instance (which would multiply into the exact N-times-slow anti-pattern
 * this adapter's HTTP approach needs to avoid).
 *
 * @param ids - discovered (or manually configured) component IDs per type
 */
export function buildPollPlan(ids: ComponentIds): PollRequest[] {
    const maxCount = Math.max(0, ...COMPONENT_TYPES.map(type => ids[type].length));
    const requests: PollRequest[] = [];

    for (let i = 0; i < maxCount; i++) {
        const request: PollRequest = { params: {}, components: [] };
        for (const type of COMPONENT_TYPES) {
            const idsForType = ids[type];
            if (i < idsForType.length) {
                request.params[ALL_READ_PARAM[type]] = idsForType[i];
                request.components.push({ type, id: idsForType[i] });
            }
        }
        if (request.components.length > 0) {
            requests.push(request);
        }
    }

    return requests;
}
