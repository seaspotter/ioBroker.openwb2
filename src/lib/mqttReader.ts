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
    coerceFieldValue,
    type ReadFieldDef,
} from './stateDefinitions';

export interface MqttConnectionConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
}

type SimpleApiType = Exclude<ComponentType, 'io'>;

const MQTT_FIELD_LOOKUP: Record<SimpleApiType, Map<string, ReadFieldDef>> = {
    chargepoint: buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS),
    counter: buildMqttFieldLookup(COUNTER_READ_FIELDS),
    battery: buildMqttFieldLookup(BATTERY_READ_FIELDS),
    pv: buildMqttFieldLookup(PV_READ_FIELDS),
    consumer: buildMqttFieldLookup(CONSUMER_READ_FIELDS),
};

export type ValueListener = (type: SimpleApiType, id: number, field: ReadFieldDef, value: ioBroker.StateValue) => void;
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

        const field = MQTT_FIELD_LOOKUP[parsed.type].get(parsed.fieldPath);
        if (!field) {
            return; // a real field we don't map yet, or a set/config topic - not an error
        }

        const value = coerceFieldValue(normalizeMqttValue(payload), field.type);
        for (const listener of this.valueListeners) {
            listener(parsed.type, parsed.id, field, value);
        }
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
