import * as utils from '@iobroker/adapter-core';
import { SimpleApiClient, type SimpleApiConnectionConfig, type SimpleApiResult } from './lib/simpleApiClient';
import { MqttReader, testMqttConnection, probeMqttComponents, type MqttConnectionConfig } from './lib/mqttReader';
import {
    parseComponentTable,
    serializeComponentTable,
    mergeDiscovered,
    mergeComponentIds,
    enabledIdsByType,
    type ComponentTableRow,
} from './lib/componentTable';
import {
    CHARGEPOINT_READ_FIELDS,
    CHARGEPOINT_CONTROL_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    PV_TOTAL_READ_FIELDS,
    CHARGEPOINT_TOTAL_READ_FIELDS,
    HOME_CONSUMPTION_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    BATTERY_CONTROL_FIELDS,
    commonFromReadField,
    commonFromWriteField,
    scaleEnergyValue,
    type ReadFieldDef,
    type EnergyUnit,
} from './lib/stateDefinitions';
import {
    COMPONENT_TYPES,
    MAX_TIMER_MS,
    DEFAULT_DISCOVERY_INTERVAL_MIN,
    type ComponentType,
    type ComponentIds,
} from './lib/constants';
import { translated, translatedComponentLabel, COMPONENT_TYPE_NAMES } from './lib/nameTranslations';

const READ_FIELDS_BY_TYPE: Partial<Record<ComponentType, ReadFieldDef[]>> = {
    chargepoint: CHARGEPOINT_READ_FIELDS,
    counter: COUNTER_READ_FIELDS,
    battery: BATTERY_READ_FIELDS,
    pv: PV_READ_FIELDS,
    consumer: CONSUMER_READ_FIELDS,
};

type TotalType = 'pv' | 'chargepoint';

const TOTAL_FIELDS_BY_TYPE: Record<TotalType, ReadFieldDef[]> = {
    pv: PV_TOTAL_READ_FIELDS,
    chargepoint: CHARGEPOINT_TOTAL_READ_FIELDS,
};

/** Describes how a write to one specific ioBroker state should be sent to simpleapi.php. */
interface ControlBinding {
    writeParam: string;
    idParam?: 'chargepoint_nr';
    componentId?: number;
    writeTransform?: (value: ioBroker.StateValue) => string | number;
}

class Openwb2 extends utils.Adapter {
    private client!: SimpleApiClient;
    private mqttReader!: MqttReader;
    private componentIds: ComponentIds = { chargepoint: [], counter: [], battery: [], pv: [], consumer: [] };
    private totalEnabled: Record<TotalType, boolean> = { pv: false, chargepoint: false };
    private readonly controlBindings = new Map<string, ControlBinding>();
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

        await this.removeLegacyObjects();

        const componentRows = parseComponentTable(this.config.componentTable);
        this.componentIds = enabledIdsByType(componentRows);
        await this.removeLegacyChargepointObjects(this.componentIds.chargepoint);
        await this.removeLegacyConsumerObjects(this.componentIds.consumer);
        this.log.info(
            `Enabled components: ${COMPONENT_TYPES.map(type => `${type}=${this.componentIds[type].length}`).join(', ')}`,
        );
        await this.createComponentObjects(this.componentIds, componentRows);

        // pv/chargepoint totals aren't a discoverable device of their own, so they ride along with
        // "at least one instance of that type is enabled" instead of getting their own row.
        this.totalEnabled = {
            pv: this.componentIds.pv.length > 0,
            chargepoint: this.componentIds.chargepoint.length > 0,
        };
        for (const type of Object.keys(this.totalEnabled) as TotalType[]) {
            if (this.totalEnabled[type]) {
                await this.createTotalObjects(type);
            }
        }
        await this.createHomeConsumptionObjects();

        this.subscribeStates('*.control.*');

        this.mqttReader.onConnectionChange(connected => {
            void this.setState('info.connection', connected, true);
        });
        this.mqttReader.onValue((type, id, field, value) => {
            if (!this.componentIds[type].includes(id)) {
                return; // observed but not enabled in the component table - ignore
            }
            const scaled = scaleEnergyValue(field, value, this.energyUnit());
            void this.setState(`${type}.${id}.${field.stateId}`, { val: scaled, ack: true });
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
        this.mqttReader.onTotalValue((type, field, value) => {
            if (!this.totalEnabled[type]) {
                return;
            }
            const scaled = scaleEnergyValue(field, value, this.energyUnit());
            void this.setState(`${type}.total.${field.stateId}`, { val: scaled, ack: true });
        });
        this.mqttReader.onHomeConsumptionValue((field, value) => {
            const scaled = scaleEnergyValue(field, value, this.energyUnit());
            void this.setState(`counter.homeConsumption.${field.stateId}`, { val: scaled, ack: true });
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

    /** Deletes objects left over from an earlier dev build of this adapter - safe no-op if absent. */
    private async removeLegacyObjects(): Promise<void> {
        await this.delObjectAsync('general', { recursive: true }).catch(() => undefined);
        await this.delObjectAsync('homeConsumption', { recursive: true }).catch(() => undefined);

        // io.<id>.* ids and output names are dynamic, so this queries for whatever exists instead
        // of a fixed list.
        const ioObjects = await this.getForeignObjectsAsync(`${this.namespace}.io.*`);
        const ioRoots = new Set<string>();
        for (const id of Object.keys(ioObjects)) {
            const relative = id.slice(`${this.namespace}.`.length);
            ioRoots.add(relative.split('.').slice(0, 2).join('.'));
        }
        for (const root of ioRoots) {
            await this.delObjectAsync(root, { recursive: true }).catch(() => undefined);
        }
    }

    /**
     * Deletes chargepoint.<id>.* objects left over from an earlier dev build - safe no-op if
     * absent.
     *
     * @param chargepointIds - currently enabled chargepoint ids
     */
    private async removeLegacyChargepointObjects(chargepointIds: number[]): Promise<void> {
        const relativePaths = [
            'control.manualSoc',
            'evseCurrent',
            'evseSignaling',
            'maxEvseCurrent',
            'minCurrent',
            'vehicleId',
            'socRangeUnit',
            'control.chargecurrent',
            'control.minimalPvSoc',
            'control.minimalPermanentCurrent',
        ];
        for (const id of chargepointIds) {
            for (const path of relativePaths) {
                await this.delObjectAsync(`chargepoint.${id}.${path}`).catch(() => undefined);
            }
        }
    }

    /**
     * Deletes consumer.<id>.phasesInUse objects left over from an earlier dev build - there is no
     * live readback for it (see CONSUMER_READ_FIELDS' own comment) - safe no-op if absent.
     *
     * @param consumerIds - currently enabled consumer ids
     */
    private async removeLegacyConsumerObjects(consumerIds: number[]): Promise<void> {
        for (const id of consumerIds) {
            await this.delObjectAsync(`consumer.${id}.phasesInUse`).catch(() => undefined);
        }
    }

    private async createComponentObjects(ids: ComponentIds, rows: ComponentTableRow[]): Promise<void> {
        const nameByKey = new Map(rows.filter(row => row.name).map(row => [`${row.type}:${row.id}`, row.name!]));
        for (const type of COMPONENT_TYPES) {
            if (ids[type].length === 0) {
                continue;
            }
            await this.ensureTypeFolder(type);
            for (const id of ids[type]) {
                await this.createComponentInstanceObjects(type, id, nameByKey.get(`${type}:${id}`));
            }
        }
    }

    /**
     * Creates the `<type>` folder object itself (e.g. `chargepoint`) - the parent of every
     * `<type>.<id>` channel. Without it, each instance channel is an "orphan" with no intermediate
     * object, which the ioBroker object-structure checker flags as an error.
     *
     * @param type - component type
     */
    private async ensureTypeFolder(type: ComponentType): Promise<void> {
        await this.extendObjectAsync(type, {
            type: 'folder',
            common: { name: COMPONENT_TYPE_NAMES[type] },
            native: {},
        });
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
            common: { name: customName ?? translatedComponentLabel(type, id) },
            native: {},
        });

        // extendObjectAsync (not setObjectNotExistsAsync) so a definition change - a fixed unit, a
        // renamed label - reaches objects an earlier adapter version already created, not just
        // fresh ones. These states are entirely code-defined (unlike the channel name above, there
        // is no user-supplied value to preserve), so always re-syncing common is safe.
        const readFields = READ_FIELDS_BY_TYPE[type] ?? [];
        for (const field of readFields) {
            await this.extendObjectAsync(`${channelId}.${field.stateId}`, {
                type: 'state',
                common: commonFromReadField(field, this.energyUnit()),
                native: {},
            });
        }

        if (type === 'chargepoint') {
            await this.extendObjectAsync(`${channelId}.control`, {
                type: 'channel',
                common: { name: translated('Control') },
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
            await this.extendObjectAsync(`${channelId}.control`, {
                type: 'channel',
                common: { name: translated('Control') },
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
     * Creates the `<type>.total.*` channel - a system-wide sum across all enabled instances of that
     * type, not a discoverable device of its own (see TOTAL_FIELDS_BY_TYPE's docs).
     *
     * @param type - which total to create
     */
    private async createTotalObjects(type: TotalType): Promise<void> {
        const channelId = `${type}.total`;
        await this.extendObjectAsync(channelId, {
            type: 'channel',
            common: { name: translated(`Total ${type}`) },
            native: {},
        });
        for (const field of TOTAL_FIELDS_BY_TYPE[type]) {
            await this.extendObjectAsync(`${channelId}.${field.stateId}`, {
                type: 'state',
                common: commonFromReadField(field, this.energyUnit()),
                native: {},
            });
        }
    }

    /**
     * Creates the singleton `counter.homeConsumption.*` channel, always, like `info.*`. Nested
     * under `counter` to match the real `openWB/simpleAPI/counter/set/...` wire segment. Stays
     * `null` if openWB isn't computing this.
     */
    private async createHomeConsumptionObjects(): Promise<void> {
        await this.ensureTypeFolder('counter');
        await this.extendObjectAsync('counter.homeConsumption', {
            type: 'channel',
            common: { name: translated('Home consumption (estimated)') },
            native: {},
        });
        for (const field of HOME_CONSUMPTION_READ_FIELDS) {
            await this.extendObjectAsync(`counter.homeConsumption.${field.stateId}`, {
                type: 'state',
                common: commonFromReadField(field, this.energyUnit()),
                native: {},
            });
        }
    }

    /** The instance-wide display unit for Wh-denominated fields - see scaleEnergyValue's docs. */
    private energyUnit(): EnergyUnit {
        return this.config.energyUnit === 'kWh' ? 'kWh' : 'Wh';
    }

    /**
     * Adds newly-observed component IDs to the persisted table (no network call - MqttReader
     * already knows what it's seen). Persisting restarts the adapter, which creates objects for the
     * new rows. Additive only: an ID no longer observed is logged, never removed, since a device
     * being temporarily offline shouldn't destroy its states without explicit confirmation.
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
     * Snapshot for the admin UI's "Probe now" button (Components tab): unions MqttReader's
     * already-observed IDs (free, no network round-trip) with a fresh short-lived probe against
     * whatever connection details the admin UI's current form holds - including a host that was
     * just typed in and never saved, which the persistent connection has no way to know about yet.
     * Does not touch the persisted component table or adapter state - the React UI merges the
     * result into its own (unsaved) local table state, so the user can review/edit before Save.
     *
     * @param obj - incoming message, `message` holds the current (possibly unsaved) MQTT connection
     *   fields - see the payload shape ComponentsTab.tsx sends
     */
    private async probeComponents(obj: ioBroker.Message): Promise<SimpleApiResult<ComponentIds>> {
        const cfg = (obj.message ?? {}) as {
            host?: string;
            mqttPort?: number;
            mqttUsername?: string;
            mqttPassword?: string;
        };
        const probed = await probeMqttComponents(
            {
                host: cfg.host || this.config.host,
                port: cfg.mqttPort ?? this.config.mqttPort,
                username: cfg.mqttUsername ?? this.config.mqttUsername,
                password: cfg.mqttPassword ?? this.config.mqttPassword,
            },
            this,
        );
        if (!probed.ok) {
            return { ok: false, error: probed.error ?? 'Probe failed' };
        }
        return { ok: true, data: mergeComponentIds(this.mqttReader.getObservedIds(), probed.data) };
    }

    /**
     * Is called if a subscribed state changes - only non-ack changes on states we created
     * ourselves (control.*) are forwarded to openWB.
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
        const params: Record<string, string | number> = { [binding.writeParam]: value };
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
                void this.probeComponents(obj).then(result => this.sendTo(obj.from, obj.command, result, obj.callback));
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
            testMqttConnection(mqttCfg, this),
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
