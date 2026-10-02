import type { ComponentType } from './constants';

/**
 * Maps our internal component type name to the real MQTT topic segment under
 * `openWB/simpleAPI/<segment>/...`. Only `battery` differs on the wire (`bat`) - the same
 * internal-vs-public naming split `MqttClient.php` has (`findAvailableIds('bat')` internally,
 * `battery` in the public HTTP API/response keys).
 */
export const SIMPLE_API_TYPE_SEGMENT: Record<ComponentType, string> = {
    chargepoint: 'chargepoint',
    counter: 'counter',
    battery: 'bat',
    pv: 'pv',
    consumer: 'consumer',
};

const SEGMENT_TO_TYPE: Record<string, ComponentType> = Object.fromEntries(
    Object.entries(SIMPLE_API_TYPE_SEGMENT).map(([type, segment]) => [segment, type as ComponentType]),
);

/**
 * One subscribe filter per `openWB/simpleAPI/#`-backed type. Deliberately broad (not just
 * `.../get/#`) - chargepoint publishes an *additional*, flatter mirror with no `get/` prefix at all
 * (see CHARGEPOINT_READ_FIELDS' header comment in stateDefinitions.ts), and subscribing to
 * everything under an id lets the field lookup table decide what's actually used rather than
 * needing two different filters per type. The extra `set/`/`config/` traffic this also picks up is
 * simply ignored by the lookup (see parseSimpleApiTopic).
 */
export const SIMPLE_API_SUBSCRIBE_FILTERS: string[] = (Object.keys(SIMPLE_API_TYPE_SEGMENT) as ComponentType[]).map(
    type => `openWB/simpleAPI/${SIMPLE_API_TYPE_SEGMENT[type]}/+/#`,
);

/** Retained presence/version marker for the simpleAPI_mqtt.py daemon. */
export const REVISION_TOPIC = 'openWB/simpleAPI/revision';

export interface ParsedSimpleApiTopic {
    type: ComponentType;
    id: number;
    /**
     * Field path relative to the id, with any `get/` prefix stripped - e.g. "power" (chargepoint's
     * flat mirror, or after stripping "get/" from counter/battery/pv/consumer's nested mirror),
     * "connected_vehicle/soc/soc", or "voltages/1". Matches ReadFieldDef.mqttField's convention
     * exactly, so callers never need to know which of the two real wire shapes applied.
     */
    fieldPath: string;
}

const SIMPLE_API_TOPIC_PATTERN = new RegExp(
    `^openWB/simpleAPI/(${Object.values(SIMPLE_API_TYPE_SEGMENT).join('|')})/(\\d+)/(.+)$`,
);

/**
 * Parses a `openWB/simpleAPI/<type>/<id>/<fieldPath>` topic (fieldPath may or may not start with
 * `get/` - see ParsedSimpleApiTopic). Deliberately does not match the id-less "lowest ID"
 * convenience mirrors (`openWB/simpleAPI/chargepoint/get/...`, no id segment) - we always use the
 * id-specific topics, one real component instance at a time.
 *
 * @param topic - full MQTT topic string
 */
export function parseSimpleApiTopic(topic: string): ParsedSimpleApiTopic | undefined {
    const match = SIMPLE_API_TOPIC_PATTERN.exec(topic);
    if (!match) {
        return undefined;
    }
    const [, segment, idStr, rawFieldPath] = match;
    const fieldPath = rawFieldPath.startsWith('get/') ? rawFieldPath.slice('get/'.length) : rawFieldPath;
    return { type: SEGMENT_TO_TYPE[segment], id: Number(idStr), fieldPath };
}

export interface ParsedTotalTopic {
    /** Only pv/chargepoint publish a system-wide total - confirmed live, nothing else does. */
    type: 'pv' | 'chargepoint';
    /** Field path with any `get/` prefix stripped, same convention as ParsedSimpleApiTopic. */
    fieldPath: string;
}

// "total" takes the place of the numeric id segment SIMPLE_API_TOPIC_PATTERN requires, so the two
// patterns never collide. Only pv/chargepoint get a true system-wide total - simpleAPI_mqtt.py's
// total_metrics dict lists only those two types, nothing for battery/counter.
const TOTAL_TOPIC_PATTERN = /^openWB\/simpleAPI\/(pv|chargepoint)\/total\/(.+)$/;

/**
 * Parses a `openWB/simpleAPI/<pv|chargepoint>/total/<fieldPath>` topic - the system-wide sum
 * across all instances of that type, not tied to any single component id.
 *
 * @param topic - full MQTT topic string
 */
export function parseTotalTopic(topic: string): ParsedTotalTopic | undefined {
    const match = TOTAL_TOPIC_PATTERN.exec(topic);
    if (!match) {
        return undefined;
    }
    const [, type, rawFieldPath] = match;
    const fieldPath = rawFieldPath.startsWith('get/') ? rawFieldPath.slice('get/'.length) : rawFieldPath;
    return { type: type as 'pv' | 'chargepoint', fieldPath };
}

export interface ParsedHomeConsumptionTopic {
    /** Field path, e.g. "home_consumption" or "daily_yield_home_consumption". */
    fieldPath: string;
}

// openWB's global virtual home-consumption counter (packages/control/counter_all/counter_all_data.py
// upstream) - a singleton, not tied to any counter id, confirmed live under this exact path
// (note: real segment is "set", not "get" - these are openWB's own computed/simulated values, not
// hardware readings, hence the different verb).
const HOME_CONSUMPTION_TOPIC_PATTERN = /^openWB\/simpleAPI\/counter\/set\/(.+)$/;

/**
 * Parses a `openWB/simpleAPI/counter/set/<fieldPath>` topic.
 *
 * @param topic - full MQTT topic string
 */
export function parseHomeConsumptionTopic(topic: string): ParsedHomeConsumptionTopic | undefined {
    const match = HOME_CONSUMPTION_TOPIC_PATTERN.exec(topic);
    return match ? { fieldPath: match[1] } : undefined;
}
