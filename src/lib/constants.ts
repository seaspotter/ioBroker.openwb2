/*
 * Non-user-configurable constants. User-configurable values (host, port, discovery interval, ...)
 * live in io-package.json's "native" section / this.config - see adapter-config.d.ts.
 */

/**
 * Component types openWB/simpleAPI# publishes. IO is deliberately excluded: it has no
 * openWB/simpleAPI equivalent at all (simpleAPI_mqtt.py only subscribes to
 * bat/pv/chargepoint/counter+consumer, never io), so supporting it would mean reading the raw,
 * non-simpleAPI openWB/io/states/# namespace - out of scope until/unless that's added upstream.
 */
export const COMPONENT_TYPES = ['chargepoint', 'counter', 'battery', 'pv', 'consumer'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/** Component IDs per type - what MqttReader observes and componentTable.ts persists. */
export type ComponentIds = Record<ComponentType, number[]>;

/**
 * Node's setTimeout/setInterval accept at most a 32-bit signed delay (2^31 - 1 ms, ~24.8 days) -
 * a larger or invalid value runs immediately/unpredictably instead of after the expected delay.
 * Used to guard user-supplied interval/timeout config values before passing them to a timer.
 */
export const MAX_TIMER_MS = 2147483647;

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_DISCOVERY_INTERVAL_MIN = 1440; // 24h
