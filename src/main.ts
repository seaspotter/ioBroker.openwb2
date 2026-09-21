import * as utils from '@iobroker/adapter-core';
import { SimpleApiClient, type SimpleApiConnectionConfig, type SimpleApiResult } from './lib/simpleApiClient';
import { MqttReader, type MqttConnectionConfig } from './lib/mqttReader';
import { parseComponentTable, serializeComponentTable, mergeDiscovered, enabledIdsByType } from './lib/componentTable';
import {
    CHARGEPOINT_READ_FIELDS,
    CHARGEPOINT_CONTROL_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    GENERAL_CONTROL_FIELDS,
    commonFromReadField,
    commonFromWriteField,
    type ReadFieldDef,
} from './lib/stateDefinitions';
import {
    COMPONENT_TYPES,
    MAX_TIMER_MS,
    DEFAULT_DISCOVERY_INTERVAL_MIN,
    type ComponentType,
    type ComponentIds,
} from './lib/constants';

const READ_FIELDS_BY_TYPE: Partial<Record<ComponentType, ReadFieldDef[]>> = {
    chargepoint: CHARGEPOINT_READ_FIELDS,
    counter: COUNTER_READ_FIELDS,
    battery: BATTERY_READ_FIELDS,
    pv: PV_READ_FIELDS,
    consumer: CONSUMER_READ_FIELDS,
};

/** Describes how a write to one specific ioBroker state should be sent to simpleapi.php. */
interface ControlBinding {
    writeParam: string;
    idParam?: 'chargepoint_nr' | 'io_nr';
    componentId?: number;
    writeTransform?: (value: ioBroker.StateValue) => string | number;
    io?: { outputName: string; outputType: 'digital_output' | 'analog_output' };
}

class Openwb2 extends utils.Adapter {
    private client!: SimpleApiClient;
    private mqttReader!: MqttReader;
    private componentIds: ComponentIds = { chargepoint: [], counter: [], battery: [], pv: [], consumer: [], io: [] };
    private readonly controlBindings = new Map<string, ControlBinding>();
    private readonly knownIoStates = new Set<string>();
    private discoveryTimer: ioBroker.Interval | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'openwb2',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration. Reads come from
     * a persistent MQTT connection (see MqttReader) rather than polling; writes stay on
     * SimpleApiClient/HTTP regardless of MQTT availability - the two are independent, so either
     * one being unconfigured only disables that half, not the whole adapter.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);
        this.client = new SimpleApiClient(this.log);
        this.mqttReader = new MqttReader(this.log);

        if (!this.config.host) {
            this.log.warn(
                'No openWB HTTP host configured - writes and "Test connection" will not work until configured',
            );
        }

        await this.createGeneralControlObjects();

        this.componentIds = enabledIdsByType(parseComponentTable(this.config.componentTable));
        this.log.info(
            `Enabled components: ${COMPONENT_TYPES.map(type => `${type}=${this.componentIds[type].length}`).join(', ')}`,
        );
        await this.createComponentObjects(this.componentIds);

        this.subscribeStates('*.control.*');
        this.subscribeStates('io.*.digital.*');
        this.subscribeStates('io.*.analog.*');

        this.mqttReader.onConnectionChange(connected => {
            void this.setState('info.connection', connected, true);
        });
        this.mqttReader.onValue((type, id, field, value) => {
            if (!this.componentIds[type].includes(id)) {
                return; // observed but not enabled in the component table - ignore
            }
            void this.setState(`${type}.${id}.${field.stateId}`, { val: value, ack: true });
        });
        this.mqttReader.onIoValue((id, outputType, name, value) => {
            if (!this.componentIds.io.includes(id)) {
                return;
            }
            void this.applyIoValue(id, outputType, name, value);
        });

        if (this.config.mqttHost) {
            this.mqttReader.connect(this.mqttConnectionConfig());
        } else {
            this.log.warn('No MQTT broker configured - reads will not work until configured in the MQTT tab');
        }

        this.discoveryTimer = this.setInterval(
            () => {
                void this.checkForNewComponents();
            },
            this.resolveIntervalMs(this.config.discoveryIntervalMin * 60_000, DEFAULT_DISCOVERY_INTERVAL_MIN * 60_000),
        );
    }

    private connectionConfig(): SimpleApiConnectionConfig {
        return {
            protocol: this.config.protocol,
            host: this.config.host,
            port: this.config.port,
            basePath: this.config.basePath,
            authMethod: this.config.authMethod,
            token: this.config.token,
            username: this.config.username,
            password: this.config.password,
            requestTimeoutMs: this.config.requestTimeoutMs,
        };
    }

    private mqttConnectionConfig(): MqttConnectionConfig {
        return {
            host: this.config.mqttHost,
            port: this.config.mqttPort,
            username: this.config.mqttUsername,
            password: this.config.mqttPassword,
        };
    }

    /**
     * Validates a configurable interval against Node's setTimeout/setInterval max delay
     * (2^31 - 1 ms) - an out-of-range or invalid value would otherwise produce unpredictable
     * timer behavior instead of the expected interval.
     *
     * @param raw - configured interval in ms
     * @param fallback - value to use if raw is invalid
     */
    private resolveIntervalMs(raw: number, fallback: number): number {
        return Number.isFinite(raw) && raw > 0 && raw <= MAX_TIMER_MS ? raw : fallback;
    }

    /** Global (not per-instance) control states - bat_mode/bat_power_reserve take no id, see project memory. */
    private async createGeneralControlObjects(): Promise<void> {
        await this.setObjectNotExistsAsync('general', { type: 'channel', common: { name: 'General' }, native: {} });
        await this.setObjectNotExistsAsync('general.control', {
            type: 'channel',
            common: { name: 'Control' },
            native: {},
        });
        for (const field of GENERAL_CONTROL_FIELDS) {
            const stateId = `general.control.${field.stateId}`;
            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: commonFromWriteField(field),
                native: {},
            });
            this.controlBindings.set(stateId, { writeParam: field.writeParam, writeTransform: field.writeTransform });
        }
    }

    private async createComponentObjects(ids: ComponentIds): Promise<void> {
        for (const type of COMPONENT_TYPES) {
            for (const id of ids[type]) {
                await this.createComponentInstanceObjects(type, id);
            }
        }
    }

    private async createComponentInstanceObjects(type: ComponentType, id: number): Promise<void> {
        const channelId = `${type}.${id}`;
        await this.setObjectNotExistsAsync(channelId, {
            type: 'channel',
            common: { name: `${type} ${id}` },
            native: {},
        });

        if (type === 'io') {
            // Output names aren't known until the first value arrives - see applyIoValue().
            await this.setObjectNotExistsAsync(`${channelId}.digital`, {
                type: 'channel',
                common: { name: 'Digital outputs' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${channelId}.analog`, {
                type: 'channel',
                common: { name: 'Analog outputs' },
                native: {},
            });
            return;
        }

        const readFields = READ_FIELDS_BY_TYPE[type] ?? [];
        for (const field of readFields) {
            await this.setObjectNotExistsAsync(`${channelId}.${field.stateId}`, {
                type: 'state',
                common: commonFromReadField(field),
                native: {},
            });
        }

        if (type === 'chargepoint') {
            await this.setObjectNotExistsAsync(`${channelId}.control`, {
                type: 'channel',
                common: { name: 'Control' },
                native: {},
            });
            for (const field of CHARGEPOINT_CONTROL_FIELDS) {
                const stateId = `${channelId}.control.${field.stateId}`;
                await this.setObjectNotExistsAsync(stateId, {
                    type: 'state',
                    common: commonFromWriteField(field),
                    native: {},
                });
                this.controlBindings.set(stateId, {
                    writeParam: field.writeParam,
                    idParam: field.idParam,
                    componentId: id,
                    writeTransform: field.writeTransform,
                });
            }
        }
    }

    /**
     * Checks whether MqttReader has observed any component IDs not already in the persisted
     * component table and, if so, adds them as new enabled rows and persists that
     * (native.componentTable is the single source of truth shared with the admin UI's Components
     * tab, see componentTable.ts). Persisting a native config change restarts the adapter
     * instance, which then re-runs onReady and creates objects for the newly added rows - so this
     * method doesn't create objects or touch this.componentIds itself. No network call is
     * involved - MqttReader already knows what it's seen from the live connection.
     *
     * Additive only: an ID no longer observed is logged, never removed from the table, since a
     * device being temporarily offline shouldn't destroy historical states/objects without
     * explicit confirmation - the same principle the admin UI's Components tab follows.
     */
    private async checkForNewComponents(): Promise<void> {
        try {
            const currentRows = parseComponentTable(this.config.componentTable);
            const observed = this.mqttReader.getObservedIds();

            const removed = COMPONENT_TYPES.flatMap(type =>
                currentRows
                    .filter(row => row.type === type && row.enabled && !observed[type].includes(row.id))
                    .map(row => `${row.type}.${row.id}`),
            );
            if (removed.length > 0) {
                this.log.warn(
                    `Components no longer observed via MQTT (not removed automatically): ${removed.join(', ')}`,
                );
            }

            const { rows, added } = mergeDiscovered(currentRows, observed);
            if (added.length === 0) {
                return;
            }

            this.log.info(
                `Discovered new components, adding to the component table (adapter will restart): ${added.map(a => `${a.type}.${a.id}`).join(', ')}`,
            );
            await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                native: { componentTable: serializeComponentTable(rows) },
            });
        } catch (err) {
            this.log.warn(`Component check failed: ${(err as Error).message}`);
        }
    }

    /**
     * Read-only snapshot for the admin UI's "Probe now" button (Components tab) - just
     * MqttReader's already-observed IDs, no network round-trip needed. Does not touch the
     * persisted component table or adapter state - the React UI merges the result into its own
     * (unsaved) local table state, so the user can review/edit before Save.
     */
    private probeComponents(): SimpleApiResult<ComponentIds> {
        return { ok: true, data: this.mqttReader.getObservedIds() };
    }

    /**
     * IO output names are dynamic (from the user's io module config, not a fixed schema), so
     * their state objects are created lazily here, the first time each name is observed.
     *
     * @param id - io component instance ID
     * @param outputType - simpleapi.php's write-side type name for this output
     * @param name - output name, as published by openWB
     * @param value - current value
     */
    private async applyIoValue(
        id: number,
        outputType: 'digital_output' | 'analog_output',
        name: string,
        value: ioBroker.StateValue,
    ): Promise<void> {
        const folder = outputType === 'digital_output' ? 'digital' : 'analog';
        const stateId = `io.${id}.${folder}.${name}`;

        if (!this.knownIoStates.has(stateId)) {
            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: {
                    name,
                    type: outputType === 'digital_output' ? 'boolean' : 'number',
                    role: outputType === 'digital_output' ? 'switch' : 'level',
                    read: true,
                    write: true,
                },
                native: {},
            });
            this.controlBindings.set(stateId, {
                writeParam: 'set_io_output',
                idParam: 'io_nr',
                componentId: id,
                io: { outputName: name, outputType },
            });
            this.knownIoStates.add(stateId);
        }

        await this.setState(stateId, { val: value, ack: true });
    }

    /**
     * Is called if a subscribed state changes - only non-ack changes on states we created
     * ourselves (control.* / io.*.digital.* / io.*.analog.*) are forwarded to openWB.
     *
     * @param id - State ID
     * @param state - State object
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        }
        const relativeId = this.toRelativeId(id);
        const binding = this.controlBindings.get(relativeId);
        if (!binding) {
            return;
        }
        void this.handleControlWrite(relativeId, binding, state);
    }

    private toRelativeId(id: string): string {
        const prefix = `${this.namespace}.`;
        return id.startsWith(prefix) ? id.slice(prefix.length) : id;
    }

    private async handleControlWrite(stateId: string, binding: ControlBinding, state: ioBroker.State): Promise<void> {
        const value = binding.writeTransform
            ? binding.writeTransform(state.val)
            : ((state.val as string | number) ?? '');
        const params: Record<string, string | number> = {};

        if (binding.io) {
            params.set_io_output = value;
            params.io_output = binding.io.outputName;
            params.io_output_type = binding.io.outputType;
        } else {
            params[binding.writeParam] = value;
        }
        if (binding.idParam && binding.componentId !== undefined) {
            params[binding.idParam] = binding.componentId;
        }

        const result = await this.client.write(this.connectionConfig(), params);
        if (result.ok) {
            await this.setState(stateId, { val: state.val, ack: true });
        } else {
            this.log.warn(`Write to ${stateId} failed: ${result.error}`);
        }
    }

    /**
     * Some message was sent to this instance over the message box - used by the admin UI's
     * "Test connection" (Connection tab), "Check now" (MQTT tab), and "Probe now" (Components
     * tab) buttons.
     *
     * @param obj - incoming message
     */
    private onMessage(obj: ioBroker.Message): void {
        if (obj.command === 'testConnection') {
            void this.handleTestConnection(obj);
            return;
        }
        if (obj.command === 'rediscoverNow') {
            void this.checkForNewComponents().then(() => {
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { result: 'Check complete' }, obj.callback);
                }
            });
            return;
        }
        if (obj.command === 'probeComponents') {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, this.probeComponents(), obj.callback);
            }
        }
    }

    private async handleTestConnection(obj: ioBroker.Message): Promise<void> {
        const cfg = (obj.message ?? {}) as SimpleApiConnectionConfig;
        const result: SimpleApiResult<Record<string, unknown>> = await this.client.read(cfg, {
            get_chargepoint_all: 0,
        });
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, result.ok ? { result: 'ok' } : { error: result.error }, obj.callback);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            if (this.discoveryTimer) {
                this.clearInterval(this.discoveryTimer);
            }
            this.mqttReader?.disconnect();
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Openwb2(options);
} else {
    // otherwise start the instance directly
    (() => new Openwb2())();
}
