import type { ComponentType } from './constants';

/**
 * Maps our internal component type name to the real MQTT topic segment under
 * `openWB/simpleAPI/<segment>/...`. Only `battery` differs on the wire (`bat`) - the same
 * internal-vs-public naming split `MqttClient.php` has (`findAvailableIds('bat')` internally,
 * `battery` in the public HTTP API/response keys).
 */
export const SIMPLE_API_TYPE_SEGMENT: Record<Exclude<ComponentType, 'io'>, string> = {
    chargepoint: 'chargepoint',
    counter: 'counter',
    battery: 'bat',
    pv: 'pv',
    consumer: 'consumer',
};

const SEGMENT_TO_TYPE: Record<string, Exclude<ComponentType, 'io'>> = Object.fromEntries(
    Object.entries(SIMPLE_API_TYPE_SEGMENT).map(([type, segment]) => [segment, type as Exclude<ComponentType, 'io'>]),
);

/**
 * One subscribe filter per `openWB/simpleAPI/#`-backed type (everything except `io`, see below).
 * Deliberately broad (not just `.../get/#`) - chargepoint publishes an *additional*, flatter
 * mirror with no `get/` prefix at all (see CHARGEPOINT_READ_FIELDS' header comment in
 * stateDefinitions.ts), and subscribing to everything under an id lets the field lookup table
 * decide what's actually used rather than needing two different filters per type. The extra
 * `set/`/`config/` traffic this also picks up is simply ignored by the lookup (see
 * parseSimpleApiTopic).
 */
export const SIMPLE_API_SUBSCRIBE_FILTERS: string[] = (
    Object.keys(SIMPLE_API_TYPE_SEGMENT) as Exclude<ComponentType, 'io'>[]
).map(type => `openWB/simpleAPI/${SIMPLE_API_TYPE_SEGMENT[type]}/+/#`);

/**
 * IO has no `openWB/simpleAPI/io/...` mirror - `simpleAPI_mqtt.py`'s `_on_connect` only
 * subscribes to bat/pv/chargepoint/counter(+consumer), not io (confirmed in source and live: zero
 * `openWB/simpleAPI/io/...` topics on a real device with IO hardware configured). Read IO from the
 * raw namespace directly instead - confirmed live to be properly JSON-encoded, no quoting
 * weirdness there.
 */
export const IO_SUBSCRIBE_FILTER = 'openWB/io/states/+/get/#';

/** Retained presence/version marker for the simpleAPI_mqtt.py daemon. */
export const REVISION_TOPIC = 'openWB/simpleAPI/revision';

export interface ParsedSimpleApiTopic {
    type: Exclude<ComponentType, 'io'>;
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

export interface ParsedIoTopic {
    id: number;
    /** e.g. "digital_output" or "analog_output" */
    fieldPath: string;
}

const IO_TOPIC_PATTERN = /^openWB\/io\/states\/(\d+)\/get\/(.+)$/;

/**
 * Parses a raw `openWB/io/states/<id>/get/<fieldPath>` topic.
 *
 * @param topic - full MQTT topic string
 */
export function parseIoTopic(topic: string): ParsedIoTopic | undefined {
    const match = IO_TOPIC_PATTERN.exec(topic);
    if (!match) {
        return undefined;
    }
    const [, idStr, fieldPath] = match;
    return { id: Number(idStr), fieldPath };
}
