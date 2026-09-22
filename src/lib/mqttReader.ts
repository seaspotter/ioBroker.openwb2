import mqtt, { type MqttClient } from 'mqtt';
import { COMPONENT_TYPES, type ComponentIds, type ComponentType } from './constants';
import { normalizeMqttValue } from './mqttValue';
import {
    SIMPLE_API_SUBSCRIBE_FILTERS,
    IO_SUBSCRIBE_FILTER,
    REVISION_TOPIC,
    parseSimpleApiTopic,
    parseIoTopic,
} from './mqttTopics';
import {
    CHARGEPOINT_READ_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    buildMqttFieldLookup,
    buildControlLiveLookup,
    coerceFieldValue,
    type ReadFieldDef,
} from './stateDefinitions';

export interface MqttConnectionConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
}

/**
 * One-shot connectivity check for the admin UI's "Test connection" button - opens a short-lived
 * connection (separate from the adapter's own persistent one), waits for either a successful
 * connect or an error/timeout, then always disconnects. Never subscribes to anything.
 *
 * @param cfg - MQTT broker connection details
 * @param timeoutMs - how long to wait before giving up (default 5s)
 */
export function testMqttConnection(
    cfg: MqttConnectionConfig,
    timeoutMs = 5000,
): Promise<{ ok: boolean; error?: string }> {
    return new Promise(resolve => {
        const client = mqtt.connect(`mqtt://${cfg.host}:${cfg.port}`, {
            username: cfg.username || undefined,
            password: cfg.password || undefined,
            connectTimeout: timeoutMs,
            reconnectPeriod: 0, // this is a one-shot probe - never auto-reconnect
        });

        let settled = false;
        const finish = (result: { ok: boolean; error?: string }): void => {
            if (settled) {
                return;
            }
            settled = true;
            client.end(true);
            resolve(result);
        };

        client.on('connect', () => finish({ ok: true }));
        client.on('error', err => finish({ ok: false, error: err.message }));
        setTimeout(() => finish({ ok: false, error: 'Timed out' }), timeoutMs);
    });
}

type SimpleApiType = Exclude<ComponentType, 'io'>;

const MQTT_FIELD_LOOKUP: Record<SimpleApiType, Map<string, ReadFieldDef>> = {
    chargepoint: buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS),
    counter: buildMqttFieldLookup(COUNTER_READ_FIELDS),
    battery: buildMqttFieldLookup(BATTERY_READ_FIELDS),
    pv: buildMqttFieldLookup(PV_READ_FIELDS),
    consumer: buildMqttFieldLookup(CONSUMER_READ_FIELDS),
};

/** Only chargepoint has any control fields with a live MQTT source - see ControlLiveSource's docs. */
const CONTROL_LIVE_LOOKUP = buildControlLiveLookup();

export type ValueListener = (type: SimpleApiType, id: number, field: ReadFieldDef, value: ioBroker.StateValue) => void;
export type ControlValueListener = (id: number, controlStateId: string, value: ioBroker.StateValue) => void;
export type IoValueListener = (
    id: number,
    outputType: 'digital_output' | 'analog_output',
    name: string,
    value: ioBroker.StateValue,
) => void;
export type ConnectionListener = (connected: boolean) => void;

/**
 * Live MQTT read path: one persistent connection, subscribed to `openWB/simpleAPI/#` (per type)
 * and the raw `openWB/io/states/#` namespace (which `simpleAPI_mqtt.py` doesn't mirror - see
 * mqttTopics.ts). Replaces the old HTTP poll cycle entirely for reads; writes stay on
 * SimpleApiClient regardless.
 *
 * Also tracks every `(type, id)` it has ever seen a message for, indefinitely, so discovery
 * (`getObservedIds`) is free/instant - no separate probe request needed, unlike the old HTTP
 * `list_components` call this replaces.
 */
export class MqttReader {
    private client: MqttClient | undefined;
    private readonly valueListeners = new Set<ValueListener>();
    private readonly controlValueListeners = new Set<ControlValueListener>();
    private readonly ioValueListeners = new Set<IoValueListener>();
    private readonly connectionListeners = new Set<ConnectionListener>();
    private readonly observed: Record<ComponentType, Set<number>> = {
        chargepoint: new Set(),
        counter: new Set(),
        battery: new Set(),
        pv: new Set(),
        consumer: new Set(),
        io: new Set(),
    };

    public constructor(private readonly log: ioBroker.Log) {}

    /**
     * @param cfg - MQTT broker connection details
     */
    public connect(cfg: MqttConnectionConfig): void {
        const url = `mqtt://${cfg.host}:${cfg.port}`;
        this.client = mqtt.connect(url, {
            username: cfg.username || undefined,
            password: cfg.password || undefined,
        });

        this.client.on('connect', () => {
            this.log.info(`Connected to MQTT broker at ${cfg.host}:${cfg.port}`);
            const filters = [...SIMPLE_API_SUBSCRIBE_FILTERS, IO_SUBSCRIBE_FILTER, REVISION_TOPIC];
            this.client?.subscribe(filters, err => {
                if (err) {
                    this.log.warn(`Failed to subscribe to MQTT topics: ${err.message}`);
                }
            });
            this.emitConnectionChange(true);
        });

        this.client.on('reconnect', () => this.log.debug('Reconnecting to MQTT broker...'));
        this.client.on('error', err => this.log.warn(`MQTT connection error: ${err.message}`));
        this.client.on('close', () => this.emitConnectionChange(false));
        this.client.on('offline', () => this.emitConnectionChange(false));
        this.client.on('message', (topic, payload) => this.handleMessage(topic, payload.toString()));
    }

    public onValue(cb: ValueListener): void {
        this.valueListeners.add(cb);
    }

    /** Fires for chargepoint control fields with a live MQTT source - see ControlLiveSource's docs. */
    public onControlValue(cb: ControlValueListener): void {
        this.controlValueListeners.add(cb);
    }

    public onIoValue(cb: IoValueListener): void {
        this.ioValueListeners.add(cb);
    }

    public onConnectionChange(cb: ConnectionListener): void {
        this.connectionListeners.add(cb);
    }

    private emitConnectionChange(connected: boolean): void {
        for (const listener of this.connectionListeners) {
            listener(connected);
        }
    }

    /** Every `(type, id)` ever observed, regardless of whether it's in the enabled component table. */
    public getObservedIds(): ComponentIds {
        const ids = { chargepoint: [], counter: [], battery: [], pv: [], consumer: [], io: [] } as ComponentIds;
        for (const type of COMPONENT_TYPES) {
            ids[type] = [...this.observed[type]].sort((a, b) => a - b);
        }
        return ids;
    }

    public disconnect(): void {
        this.client?.end(true);
        this.client = undefined;
    }

    private handleMessage(topic: string, payload: string): void {
        if (topic === REVISION_TOPIC) {
            this.log.debug(`simpleAPI_mqtt.py revision: ${payload}`);
            return;
        }

        const io = parseIoTopic(topic);
        if (io) {
            this.handleIoMessage(io.id, io.fieldPath, payload);
            return;
        }

        const parsed = parseSimpleApiTopic(topic);
        if (!parsed) {
            return;
        }

        this.observed[parsed.type].add(parsed.id);
        const normalized = normalizeMqttValue(payload);

        const field = MQTT_FIELD_LOOKUP[parsed.type].get(parsed.fieldPath);
        if (field) {
            const value = coerceFieldValue(normalized, field.type);
            for (const listener of this.valueListeners) {
                listener(parsed.type, parsed.id, field, value);
            }
        }

        if (parsed.type === 'chargepoint') {
            const controlField = CONTROL_LIVE_LOOKUP.get(parsed.fieldPath);
            if (controlField) {
                const raw = controlField.fromMqtt ? controlField.fromMqtt(normalized) : normalized;
                const value = coerceFieldValue(raw, controlField.type);
                for (const listener of this.controlValueListeners) {
                    listener(parsed.id, controlField.controlStateId, value);
                }
            }
        }
        // a field matching neither lookup is a real field we don't map yet, or a set/config topic
        // we don't route - not an error either way.
    }

    private handleIoMessage(id: number, fieldPath: string, payload: string): void {
        this.observed.io.add(id);

        if (fieldPath !== 'digital_output' && fieldPath !== 'analog_output') {
            return; // digital_input, fault_str, etc. - not writable outputs, nothing to route
        }
        const outputType = fieldPath;
        const valueType = outputType === 'digital_output' ? 'boolean' : 'number';

        const parsed = normalizeMqttValue(payload);
        if (!parsed || typeof parsed !== 'object') {
            return;
        }
        for (const [name, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
            const value = coerceFieldValue(rawValue, valueType);
            for (const listener of this.ioValueListeners) {
                listener(id, outputType, name, value);
            }
        }
    }
}
