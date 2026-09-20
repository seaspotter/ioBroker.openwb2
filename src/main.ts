import * as utils from '@iobroker/adapter-core';
import { SimpleApiClient, type SimpleApiConnectionConfig, type SimpleApiResult } from './lib/simpleApiClient';
import { discoverComponents, discoverViaListComponents, type ComponentIds } from './lib/discovery';
import { parseComponentTable, serializeComponentTable, mergeDiscovered } from './lib/componentTable';
import { buildPollPlan, type PollRequest } from './lib/pollPlanner';
import { runWithConcurrency } from './lib/concurrency';
import {
    CHARGEPOINT_READ_FIELDS,
    CHARGEPOINT_CONTROL_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    GENERAL_CONTROL_FIELDS,
    extractReadValue,
    commonFromReadField,
    commonFromWriteField,
    type ReadFieldDef,
} from './lib/stateDefinitions';
import {
    COMPONENT_TYPES,
    RESPONSE_KEY_PREFIX,
    MAX_TIMER_MS,
    DEFAULT_POLL_INTERVAL_S,
    DEFAULT_POLL_CONCURRENCY,
    DEFAULT_DISCOVERY_INTERVAL_MIN,
    type ComponentType,
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
    private componentIds: ComponentIds = { chargepoint: [], counter: [], battery: [], pv: [], consumer: [], io: [] };
    private readonly controlBindings = new Map<string, ControlBinding>();
    private readonly knownIoStates = new Set<string>();
    private pollTimer: ioBroker.Interval | undefined;
    private discoveryTimer: ioBroker.Interval | undefined;
    private polling = false;

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
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);
        this.client = new SimpleApiClient(this.log);

        if (!this.config.host) {
            this.log.error('No host configured - adapter will stay idle until configured');
            return;
        }

        await this.createGeneralControlObjects();

        const discovery = await discoverComponents(
            this.client,
            this.connectionConfig(),
            parseComponentTable(this.config.componentTable),
        );
        this.componentIds = discovery.ids;
        this.log.info(
            `Discovery via ${discovery.source}: ${COMPONENT_TYPES.map(type => `${type}=${discovery.ids[type].length}`).join(', ')}`,
        );
        if (discovery.source === 'manual' && COMPONENT_TYPES.every(type => discovery.ids[type].length === 0)) {
            this.log.warn(
                'list_components is not available on this openWB core (needs openWB/core PR #3981 or later) ' +
                    'and the component table is empty - nothing will be polled. ' +
                    'Open the instance settings\' "Components" tab to probe for devices or add IDs by hand.',
            );
        }
        await this.createComponentObjects(discovery.ids);

        this.subscribeStates('*.control.*');
        this.subscribeStates('io.*.digital.*');
        this.subscribeStates('io.*.analog.*');

        await this.poll();

        this.pollTimer = this.setInterval(
            () => {
                void this.poll();
            },
            this.resolveIntervalMs(this.config.pollIntervalS * 1000, DEFAULT_POLL_INTERVAL_S * 1000),
        );
        this.discoveryTimer = this.setInterval(
            () => {
                void this.rediscover();
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

    private resolvePollConcurrency(): number {
        const n = Number(this.config.pollConcurrency);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_CONCURRENCY;
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
            // Output names aren't known until the first poll response - see routeIoGroup().
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
     * Re-runs live discovery (list_components only - see discoverViaListComponents) and, if it
     * finds component IDs not already in the persisted component table, adds them as new enabled
     * rows and persists that (native.componentTable is the single source of truth shared with the
     * admin UI's Components tab, see componentTable.ts). Persisting a native config change
     * restarts the adapter instance, which then re-runs onReady and creates objects for the newly
     * added rows - so this method doesn't create objects or touch this.componentIds itself.
     *
     * Additive only: an ID no longer reported is logged, never removed from the table, since a
     * discovery hiccup (or a device being temporarily offline) shouldn't destroy historical
     * states/objects without explicit confirmation - the same principle the admin UI's Components
     * tab follows when a "Probe now" no longer reports a row.
     */
    private async rediscover(): Promise<void> {
        try {
            const discovered = await discoverViaListComponents(this.client, this.connectionConfig());
            if (!discovered) {
                this.log.debug(
                    'list_components not available - skipping automatic rediscovery (add IDs manually in the Components tab instead)',
                );
                return;
            }

            const currentRows = parseComponentTable(this.config.componentTable);
            const removed = COMPONENT_TYPES.flatMap(type =>
                currentRows
                    .filter(row => row.type === type && row.enabled && !discovered[type].includes(row.id))
                    .map(row => `${row.type}.${row.id}`),
            );
            if (removed.length > 0) {
                this.log.warn(
                    `Components no longer reported by discovery (not removed automatically): ${removed.join(', ')}`,
                );
            }

            const { rows, added } = mergeDiscovered(currentRows, discovered);
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
            this.log.warn(`Rediscovery failed: ${(err as Error).message}`);
        }
    }

    /**
     * Read-only live discovery probe for the admin UI's "Probe now" button (Components tab). Does
     * not touch the persisted component table or adapter state - the React UI merges the result
     * into its own (unsaved) local table state, so the user can review/edit before Save.
     */
    private async probeComponents(): Promise<SimpleApiResult<ComponentIds>> {
        const discovered = await discoverViaListComponents(this.client, this.connectionConfig());
        if (!discovered) {
            return { ok: false, error: 'list_components is not available on this openWB core' };
        }
        return { ok: true, data: discovered };
    }

    /**
     * Runs one poll cycle: builds the batched request plan, executes it with bounded
     * concurrency, and routes each successful response into state updates.
     */
    private async poll(): Promise<void> {
        if (this.polling) {
            return; // previous cycle still running (e.g. a slow/unreachable device) - skip this tick
        }
        this.polling = true;

        try {
            const plan = buildPollPlan(this.componentIds);
            if (plan.length === 0) {
                this.log.debug('No components discovered/configured - nothing to poll');
                return;
            }

            const cfg = this.connectionConfig();
            const tasks = plan.map((request: PollRequest) => async () => ({
                request,
                result: await this.client.read(cfg, request.params),
            }));
            const outcomes = await runWithConcurrency(tasks, this.resolvePollConcurrency());

            let successCount = 0;
            const errors: string[] = [];
            for (const { request, result } of outcomes) {
                if (result.ok) {
                    successCount++;
                    this.routePollResponse(request.components, result.data);
                } else {
                    errors.push(result.error);
                }
            }

            await this.setState('info.connection', successCount > 0, true);
            if (errors.length > 0) {
                this.log.warn(`${errors.length}/${plan.length} poll requests failed, e.g.: ${errors[0]}`);
            }
        } catch (err) {
            this.log.error(`Poll cycle failed: ${(err as Error).message}`);
            await this.setState('info.connection', false, true);
        } finally {
            this.polling = false;
        }
    }

    private routePollResponse(components: { type: ComponentType; id: number }[], data: Record<string, unknown>): void {
        for (const { type, id } of components) {
            const key = `${RESPONSE_KEY_PREFIX[type]}_${id}`;
            const raw = data[key];
            if (!raw || typeof raw !== 'object') {
                continue;
            }
            const component = raw as Record<string, unknown>;

            if (type === 'io') {
                void this.routeIoResponse(id, component);
                continue;
            }

            for (const field of READ_FIELDS_BY_TYPE[type] ?? []) {
                void this.setState(`${type}.${id}.${field.stateId}`, {
                    val: extractReadValue(component, field),
                    ack: true,
                });
            }
        }
    }

    private async routeIoResponse(id: number, component: Record<string, unknown>): Promise<void> {
        await this.routeIoGroup(id, 'digital_output', 'digital', component.digital_output, 'boolean');
        await this.routeIoGroup(id, 'analog_output', 'analog', component.analog_output, 'number');
    }

    /**
     * IO output names are dynamic (from the user's io module config, not a fixed schema), so
     * their state objects are created lazily here, the first time each name is observed.
     *
     * @param id - io component instance ID
     * @param outputType - simpleapi.php's write-side type name for this group
     * @param folder - state id folder ("digital" | "analog")
     * @param raw - the digital_output/analog_output map from the response
     * @param valueType - ioBroker state type for this group's values
     */
    private async routeIoGroup(
        id: number,
        outputType: 'digital_output' | 'analog_output',
        folder: 'digital' | 'analog',
        raw: unknown,
        valueType: 'boolean' | 'number',
    ): Promise<void> {
        if (!raw || typeof raw !== 'object') {
            return;
        }

        for (const [outputName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
            const stateId = `io.${id}.${folder}.${outputName}`;
            if (!this.knownIoStates.has(stateId)) {
                await this.setObjectNotExistsAsync(stateId, {
                    type: 'state',
                    common: {
                        name: outputName,
                        type: valueType,
                        role: valueType === 'boolean' ? 'switch' : 'level',
                        read: true,
                        write: true,
                    },
                    native: {},
                });
                this.controlBindings.set(stateId, {
                    writeParam: 'set_io_output',
                    idParam: 'io_nr',
                    componentId: id,
                    io: { outputName, outputType },
                });
                this.knownIoStates.add(stateId);
            }

            const val = valueType === 'boolean' ? Boolean(rawValue) : Number(rawValue) || 0;
            await this.setState(stateId, { val, ack: true });
        }
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
     * "Test connection" (Connection tab), "Rediscover now" (Polling tab), and "Probe now"
     * (Components tab) buttons.
     *
     * @param obj - incoming message
     */
    private onMessage(obj: ioBroker.Message): void {
        if (obj.command === 'testConnection') {
            void this.handleTestConnection(obj);
            return;
        }
        if (obj.command === 'rediscoverNow') {
            void this.rediscover().then(() => {
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { result: 'Rediscovery complete' }, obj.callback);
                }
            });
            return;
        }
        if (obj.command === 'probeComponents') {
            void this.probeComponents().then(result => {
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, result, obj.callback);
                }
            });
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
            if (this.pollTimer) {
                this.clearInterval(this.pollTimer);
            }
            if (this.discoveryTimer) {
                this.clearInterval(this.discoveryTimer);
            }
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
