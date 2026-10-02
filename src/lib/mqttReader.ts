import mqtt, { type MqttClient } from 'mqtt';
import { COMPONENT_TYPES, type ComponentIds, type ComponentType } from './constants';
import { normalizeMqttValue } from './mqttValue';
import {
    SIMPLE_API_SUBSCRIBE_FILTERS,
    REVISION_TOPIC,
    parseSimpleApiTopic,
    parseTotalTopic,
    parseHomeConsumptionTopic,
} from './mqttTopics';
import {
    CHARGEPOINT_READ_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    PV_TOTAL_READ_FIELDS,
    CHARGEPOINT_TOTAL_READ_FIELDS,
    HOME_CONSUMPTION_READ_FIELDS,
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

const MQTT_FIELD_LOOKUP: Record<ComponentType, Map<string, ReadFieldDef>> = {
    chargepoint: buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS),
    counter: buildMqttFieldLookup(COUNTER_READ_FIELDS),
    battery: buildMqttFieldLookup(BATTERY_READ_FIELDS),
    pv: buildMqttFieldLookup(PV_READ_FIELDS),
    consumer: buildMqttFieldLookup(CONSUMER_READ_FIELDS),
};

/** Only chargepoint has any control fields with a live MQTT source - see ControlLiveSource's docs. */
const CONTROL_LIVE_LOOKUP = buildControlLiveLookup();

type TotalType = 'pv' | 'chargepoint';

/** System-wide sums across all instances of a type - see PV_TOTAL_READ_FIELDS' docs. */
const TOTAL_FIELD_LOOKUP: Record<TotalType, Map<string, ReadFieldDef>> = {
    pv: buildMqttFieldLookup(PV_TOTAL_READ_FIELDS),
    chargepoint: buildMqttFieldLookup(CHARGEPOINT_TOTAL_READ_FIELDS),
};

/** openWB's global virtual home-consumption counter - see HOME_CONSUMPTION_READ_FIELDS' docs. */
const HOME_CONSUMPTION_FIELD_LOOKUP = buildMqttFieldLookup(HOME_CONSUMPTION_READ_FIELDS);

export type ValueListener = (type: ComponentType, id: number, field: ReadFieldDef, value: ioBroker.StateValue) => void;
export type ControlValueListener = (id: number, controlStateId: string, value: ioBroker.StateValue) => void;
export type TotalValueListener = (type: TotalType, field: ReadFieldDef, value: ioBroker.StateValue) => void;
export type HomeConsumptionValueListener = (field: ReadFieldDef, value: ioBroker.StateValue) => void;
export type ConnectionListener = (connected: boolean) => void;

/**
 * Live MQTT read path: one persistent connection, subscribed to `openWB/simpleAPI/#` (per type).
 * Writes stay on SimpleApiClient/HTTP regardless - the two are independent.
 *
 * Also tracks every `(type, id)` it has ever seen a message for, indefinitely, so discovery
 * (`getObservedIds`) is free/instant - no separate probe request needed.
 */
export class MqttReader {
    private client: MqttClient | undefined;
    private readonly valueListeners = new Set<ValueListener>();
    private readonly controlValueListeners = new Set<ControlValueListener>();
    private readonly totalValueListeners = new Set<TotalValueListener>();
    private readonly homeConsumptionValueListeners = new Set<HomeConsumptionValueListener>();
    private readonly connectionListeners = new Set<ConnectionListener>();
    private readonly observed: Record<ComponentType, Set<number>> = {
        chargepoint: new Set(),
        counter: new Set(),
        battery: new Set(),
        pv: new Set(),
        consumer: new Set(),
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
            const filters = [...SIMPLE_API_SUBSCRIBE_FILTERS, REVISION_TOPIC];
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

    /** Fires for the system-wide pv/chargepoint totals - see PV_TOTAL_READ_FIELDS' docs. */
    public onTotalValue(cb: TotalValueListener): void {
        this.totalValueListeners.add(cb);
    }

    /** Fires for openWB's global virtual home-consumption counter - see HOME_CONSUMPTION_READ_FIELDS' docs. */
    public onHomeConsumptionValue(cb: HomeConsumptionValueListener): void {
        this.homeConsumptionValueListeners.add(cb);
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
        const ids = { chargepoint: [], counter: [], battery: [], pv: [], consumer: [] } as ComponentIds;
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

        const parsed = parseSimpleApiTopic(topic);
        if (!parsed) {
            // "total"/"set" aren't numeric ids, so parseSimpleApiTopic never matches these - they
            // need their own id-less routing instead.
            this.handleTotalOrHomeConsumptionMessage(topic, payload);
            return;
        }

        this.observed[parsed.type].add(parsed.id);
        const normalized = normalizeMqttValue(payload);

        const field = MQTT_FIELD_LOOKUP[parsed.type].get(parsed.fieldPath);
        if (field) {
            const raw = field.fromMqtt ? field.fromMqtt(normalized) : normalized;
            const value = coerceFieldValue(raw, field.type);
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

    /** Routes the two id-less topic shapes parseSimpleApiTopic can never match - see their own parsers' docs. */
    private handleTotalOrHomeConsumptionMessage(topic: string, payload: string): void {
        const normalized = normalizeMqttValue(payload);

        const total = parseTotalTopic(topic);
        if (total) {
            const field = TOTAL_FIELD_LOOKUP[total.type].get(total.fieldPath);
            if (field) {
                const raw = field.fromMqtt ? field.fromMqtt(normalized) : normalized;
                const value = coerceFieldValue(raw, field.type);
                for (const listener of this.totalValueListeners) {
                    listener(total.type, field, value);
                }
            }
            return;
        }

        const homeConsumption = parseHomeConsumptionTopic(topic);
        if (homeConsumption) {
            const field = HOME_CONSUMPTION_FIELD_LOOKUP.get(homeConsumption.fieldPath);
            if (field) {
                const raw = field.fromMqtt ? field.fromMqtt(normalized) : normalized;
                const value = coerceFieldValue(raw, field.type);
                for (const listener of this.homeConsumptionValueListeners) {
                    listener(field, value);
                }
            }
        }
    }
}
