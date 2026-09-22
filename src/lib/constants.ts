/*
 * Non-user-configurable constants. User-configurable values (host, port, poll interval, ...)
 * live in io-package.json's "native" section / this.config - see adapter-config.d.ts.
 */

/** Component types simpleAPI's list_components endpoint and the probing fallback both understand. */
export const COMPONENT_TYPES = ['chargepoint', 'counter', 'battery', 'pv', 'consumer', 'io'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * Component IDs per type - what discovery.ts produces and componentTable.ts persists. Lives here
 * (not in discovery.ts) so componentTable.ts can depend on it without a circular import between
 * the two.
 */
export type ComponentIds = Record<ComponentType, number[]>;

/** Read param used per type to fetch one component's full data set (see ParameterHandler.php). */
export const ALL_READ_PARAM: Record<ComponentType, string> = {
    chargepoint: 'get_chargepoint_all',
    counter: 'get_counter',
    battery: 'battery',
    pv: 'pv',
    consumer: 'get_consumer_all',
    io: 'get_io_output_all',
};

/** Response object key prefix simpleapi.php uses for each type, e.g. "chargepoint_0". */
export const RESPONSE_KEY_PREFIX: Record<ComponentType, string> = {
    chargepoint: 'chargepoint',
    counter: 'counter',
    battery: 'battery',
    pv: 'pv',
    consumer: 'consumer',
    io: 'io',
};

/**
 * Node's setTimeout/setInterval accept at most a 32-bit signed delay (2^31 - 1 ms, ~24.8 days) -
 * a larger or invalid value runs immediately/unpredictably instead of after the expected delay.
 * Used to guard user-supplied interval/timeout config values before passing them to a timer.
 */
export const MAX_TIMER_MS = 2147483647;

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_POLL_INTERVAL_S = 15;
export const DEFAULT_POLL_CONCURRENCY = 4;
export const DEFAULT_DISCOVERY_INTERVAL_MIN = 1440; // 24h

/** simpleapi.php's own param name for the list_components discovery endpoint. */
export const LIST_COMPONENTS_PARAM = 'list_components';
