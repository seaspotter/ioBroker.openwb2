import * as utils from '@iobroker/adapter-core';
import { SimpleApiClient, type SimpleApiConnectionConfig, type SimpleApiResult } from './lib/simpleApiClient';
import { MqttReader, testMqttConnection, type MqttConnectionConfig } from './lib/mqttReader';
import {
    parseComponentTable,
    serializeComponentTable,
    mergeDiscovered,
    enabledIdsByType,
    type ComponentTableRow,
} from './lib/componentTable';
import {
    CHARGEPOINT_READ_FIELDS,
    CHARGEPOINT_CONTROL_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    BATTERY_CONTROL_FIELDS,
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
            this.log.warn('No openWB host configured - nothing will work until configured in the Connection tab');
        }

        await this.removeLegacyGeneralControlObjects();

        const componentRows = parseComponentTable(this.config.componentTable);
        this.componentIds = enabledIdsByType(componentRows);
        await this.removeLegacyManualSocObjects(this.componentIds.chargepoint);
        this.log.info(
            `Enabled components: ${COMPONENT_TYPES.map(type => `${type}=${this.componentIds[type].length}`).join(', ')}`,
        );
        await this.createComponentObjects(this.componentIds, componentRows);

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
        this.mqttReader.onControlValue((id, controlStateId, value) => {
            if (!this.componentIds.chargepoint.includes(id)) {
                return;
            }
            // Same live-updated as any read state, ack:true - this is what makes "does writing
            // confirm the actual value" true: whether the change came from our own write or from
            // openWB's own UI, the device republishes it and this fires again shortly after.
            void this.setState(`chargepoint.${id}.control.${controlStateId}`, { val: value, ack: true });
        });
        this.mqttReader.onIoValue((id, outputType, name, value) => {
            if (!this.componentIds.io.includes(id)) {
                return;
            }
            void this.applyIoValue(id, outputType, name, value);
        });

        if (this.config.host) {
            this.mqttReader.connect(this.mqttConnectionConfig());
        }

        // 0 genuinely disables the periodic check (not "invalid, fall back to default") - a user
        // who only ever wants to discover new components via the manual "Probe now" button should
        // be able to turn the background one off entirely.
        if (this.config.discoveryIntervalMin !== 0) {
            this.discoveryTimer = this.setInterval(
                () => {
                    void this.checkForNewComponents();
                },
                this.resolveIntervalMs(
                    this.config.discoveryIntervalMin * 60_000,
                    DEFAULT_DISCOVERY_INTERVAL_MIN * 60_000,
                ),
            );
        }
    }

    private connectionConfig(): SimpleApiConnectionConfig {
        return {
            protocol: this.config.protocol,
            host: this.config.host,
            port: this.config.port,
            authMethod: this.config.authMethod,
            token: this.config.token,
            username: this.config.username,
            password: this.config.password,
            requestTimeoutMs: this.config.requestTimeoutMs,
        };
    }

    /** Shares `this.config.host` with the HTTP side - see adapter-config.d.ts's note on `host`. */
    private mqttConnectionConfig(): MqttConnectionConfig {
        return {
            host: this.config.host,
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

    /**
     * bat_mode/bat_power_reserve used to live under a standalone `general.control.*` channel;
     * they now live under each battery instance's own control channel instead (see
     * createComponentInstanceObjects). Removes the old objects so a dev/test install doesn't keep
     * an orphaned empty "General" folder around after upgrading.
     */
    private async removeLegacyGeneralControlObjects(): Promise<void> {
        await this.delObjectAsync('general', { recursive: true }).catch(() => undefined);
    }

    /**
     * manualSoc was removed from CHARGEPOINT_CONTROL_FIELDS (no live MQTT confirmation was
     * possible for it, and it was rarely useful) - cleans up any already-created
     * chargepoint.<id>.control.manualSoc object left over from before that change.
     *
     * @param chargepointIds - currently enabled chargepoint ids
     */
    private async removeLegacyManualSocObjects(chargepointIds: number[]): Promise<void> {
        for (const id of chargepointIds) {
            await this.delObjectAsync(`chargepoint.${id}.control.manualSoc`).catch(() => undefined);
        }
    }

    private async createComponentObjects(ids: ComponentIds, rows: ComponentTableRow[]): Promise<void> {
        const nameByKey = new Map(rows.filter(row => row.name).map(row => [`${row.type}:${row.id}`, row.name!]));
        for (const type of COMPONENT_TYPES) {
            for (const id of ids[type]) {
                await this.createComponentInstanceObjects(type, id, nameByKey.get(`${type}:${id}`));
            }
        }
    }

    /**
     * @param type - component type
     * @param id - component instance id
     * @param customName - user-supplied name from the component table (Components tab), if any -
     *   always applied (not just on first creation) so renaming an existing row takes effect on
     *   the next restart without needing to delete/recreate the channel object.
     */
    private async createComponentInstanceObjects(type: ComponentType, id: number, customName?: string): Promise<void> {
        const channelId = `${type}.${id}`;
        await this.extendObjectAsync(channelId, {
            type: 'channel',
            common: { name: customName ?? `${type} ${id}` },
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

        // extendObjectAsync (not setObjectNotExistsAsync) so a definition change - a fixed unit, a
        // renamed label - reaches objects an earlier adapter version already created, not just
        // fresh ones. These states are entirely code-defined (unlike the channel name above, there
        // is no user-supplied value to preserve), so always re-syncing common is safe.
        const readFields = READ_FIELDS_BY_TYPE[type] ?? [];
        for (const field of readFields) {
            await this.extendObjectAsync(`${channelId}.${field.stateId}`, {
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
                await this.extendObjectAsync(stateId, {
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

        if (type === 'battery') {
            await this.setObjectNotExistsAsync(`${channelId}.control`, {
                type: 'channel',
                common: { name: 'Control' },
                native: {},
            });
            for (const field of BATTERY_CONTROL_FIELDS) {
                const stateId = `${channelId}.control.${field.stateId}`;
                await this.extendObjectAsync(stateId, {
                    type: 'state',
                    common: commonFromWriteField(field),
                    native: {},
                });
                // No idParam/componentId - bat_mode/bat_power_reserve are genuinely global writes
                // (see BATTERY_CONTROL_FIELDS' own comment), even though the state lives under this
                // specific battery id's channel.
                this.controlBindings.set(stateId, {
                    writeParam: field.writeParam,
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
     * "Test connection" (Connection tab) and "Probe now" (Components tab) buttons.
     *
     * @param obj - incoming message
     */
    private onMessage(obj: ioBroker.Message): void {
        if (obj.command === 'testConnection') {
            void this.handleTestConnection(obj);
            return;
        }
        if (obj.command === 'probeComponents') {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, this.probeComponents(), obj.callback);
            }
        }
    }

    /**
     * Tests both the HTTP (write) and MQTT (read) connections in one go, since the admin UI's
     * Connection tab has a single combined "Test connection" button - see the message payload
     * shape ConnectionTab.tsx sends.
     *
     * @param obj - incoming message, `message` holds both the HTTP and MQTT connection fields
     */
    private async handleTestConnection(obj: ioBroker.Message): Promise<void> {
        const cfg = (obj.message ?? {}) as SimpleApiConnectionConfig & {
            mqttPort: number;
            mqttUsername: string;
            mqttPassword: string;
        };
        const mqttCfg: MqttConnectionConfig = {
            host: cfg.host,
            port: cfg.mqttPort,
            username: cfg.mqttUsername,
            password: cfg.mqttPassword,
        };

        const [http, mqtt] = await Promise.all([
            // get_lastlivevaluesjson reads one always-retained, ID-independent topic - unlike
            // get_chargepoint_all, it can't hit a nonexistent-ID mosquitto_sub timeout (~8s on
            // the real device, confirmed live) just because chargepoint 0 happens not to exist.
            this.client.read(cfg, { get_lastlivevaluesjson: 1 }),
            testMqttConnection(mqttCfg),
        ]);

        if (obj.callback) {
            this.sendTo(
                obj.from,
                obj.command,
                {
                    http: http.ok ? { ok: true } : { ok: false, error: http.error },
                    mqtt,
                },
                obj.callback,
            );
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
