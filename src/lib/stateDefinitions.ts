/*
 * Declarative field tables mapping simpleAPI's `_all` response fields to ioBroker states, and the
 * writable "control" fields to their simpleapi.php write params. Driven from a single source of
 * truth per type instead of hand-wiring ~90 fields individually in main.ts - see
 * ParameterHandler.php's getChargepointAll/getCounter/getBattery/getPv/getConsumerAll for the
 * exact source field sets these mirror.
 */

export interface ReadFieldDef {
    /** key (or array-valued key, with arrayIndex) inside the `<type>_<id>` response object */
    sourceField: string;
    /** index into the array at sourceField, for per-phase fields like voltages[0..2] */
    arrayIndex?: number;
    /**
     * Field path relative to `openWB/simpleAPI/<type>/<id>/`, with any `get/` prefix already
     * normalized away by mqttTopics.ts's parser (counter/battery/pv/consumer only publish a
     * nested `get/<field>` mirror; chargepoint additionally has a flatter mirror with no `get/`
     * prefix at all, which most chargepoint fields use instead - see CHARGEPOINT_READ_FIELDS'
     * header comment - so field tables never need to think about which shape applies). 1-based for
     * phase fields (`voltages/1`, not `voltages/0`) to match the real wire format, verified
     * against a live device. Undefined for the handful of fields that only exist in the HTTP
     * `_all` response with no MQTT equivalent found.
     */
    mqttField?: string;
    /** ioBroker state id suffix, relative to the component's channel */
    stateId: string;
    name: string;
    type: 'number' | 'string' | 'boolean';
    role: string;
    unit?: string;
}

export interface WriteFieldDef {
    stateId: string;
    name: string;
    type: 'number' | 'string' | 'boolean';
    role: string;
    unit?: string;
    /** simpleapi.php write parameter name, e.g. "set_chargemode" */
    writeParam: string;
    /** which id field simpleapi.php expects alongside the write param; undefined = global (no id) */
    idParam?: 'chargepoint_nr' | 'io_nr';
    /** value -> label, for enum-like writable fields (rendered as a dropdown by the admin UI) */
    states?: Record<string, string>;
    min?: number;
    max?: number;
    /** transforms the ioBroker state value into what simpleapi.php expects on the wire */
    writeTransform?: (value: ioBroker.StateValue) => string | number;
}

/**
 * @param sourceField - key inside the HTTP `_all` response object
 * @param stateId - ioBroker state id suffix
 * @param name - human-readable label
 * @param role - ioBroker role
 * @param unit - ioBroker unit
 * @param mqttField - topic path override; defaults to `sourceField` (true for most fields - see
 *   the per-table comments for the ones where the real MQTT field name actually differs)
 */
function num(
    sourceField: string,
    stateId: string,
    name: string,
    role: string,
    unit?: string,
    mqttField: string | undefined = sourceField,
): ReadFieldDef {
    return { sourceField, stateId, name, type: 'number', role, unit, mqttField };
}

function str(
    sourceField: string,
    stateId: string,
    name: string,
    role = 'text',
    mqttField: string | undefined = sourceField,
): ReadFieldDef {
    return { sourceField, stateId, name, type: 'string', role, mqttField };
}

function bool(
    sourceField: string,
    stateId: string,
    name: string,
    role = 'indicator',
    mqttField: string | undefined = sourceField,
): ReadFieldDef {
    return { sourceField, stateId, name, type: 'boolean', role, mqttField };
}

/**
 * Expands an array-valued source field (e.g. "voltages") into one ReadFieldDef per phase. The
 * real wire format is 1-based (`voltages/1`, not `voltages/0`) - verified live against a real
 * device, for both the nested `get/voltages/<n>` shape (counter/battery/pv/consumer) and
 * chargepoint's flatter `<field>/<n>` mirror (see CHARGEPOINT_READ_FIELDS' header comment).
 *
 * @param sourceField - key inside the HTTP `_all` response object
 * @param stateIdPrefix - ioBroker state id prefix (phase number gets appended)
 * @param namePrefix - human-readable label prefix
 * @param role - ioBroker role
 * @param unit - ioBroker unit
 */
function phases(
    sourceField: string,
    stateIdPrefix: string,
    namePrefix: string,
    role: string,
    unit?: string,
): ReadFieldDef[] {
    return [0, 1, 2].map(i => ({
        sourceField,
        arrayIndex: i,
        mqttField: `${sourceField}/${i + 1}`,
        stateId: `${stateIdPrefix}_p${i + 1}`,
        name: `${namePrefix} phase ${i + 1}`,
        type: 'number' as const,
        role,
        unit,
    }));
}

/*
 * Chargepoint mqttField values default to a *flat* `openWB/simpleAPI/chargepoint/<id>/<field>`
 * mirror - verified live against a real device to exist for chargepoint specifically (not
 * present for counter/battery/pv/consumer, which only have the nested `get/<field>` mirror).
 * This flat layer conveniently reuses the same field names as the HTTP `_all` response's JSON
 * keys almost everywhere, including chargemode/manual_lock/pro_soc (which the nested nested
 * `get/`-mirror layer does *not* expose under those names) - so most fields below need no
 * override at all. The handful of exceptions (a different name, or no flat equivalent at all,
 * falling back to a nested path) are called out explicitly.
 */
export const CHARGEPOINT_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('voltages', 'voltage', 'Voltage', 'value.voltage', 'V'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    ...phases('powers', 'power', 'Power', 'value.power', 'W'),
    str('state_str', 'stateStr', 'State'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
    // imported/exported (and their daily variants) are always Wh on the wire, regardless of type -
    // confirmed live against a real device (see stateDefinitions.test.ts).
    num('imported', 'imported', 'Energy imported', 'value.energy', 'Wh'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'Wh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'Wh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'Wh'),
    num('phases_in_use', 'phasesInUse', 'Phases in use', 'value'),
    bool('plug_state', 'plugState', 'Vehicle plugged in'),
    bool('charge_state', 'chargeState', 'Currently charging'),
    num('pro_soc', 'proSoc', 'State of charge (chargepoint-reported)', 'value.battery', '%'),
    str('soc_timestamp', 'socTimestamp', 'State of charge timestamp'),
    num('vehicle_id', 'vehicleId', 'Assigned vehicle ID', 'value'),
    num('evse_current', 'evseCurrent', 'EVSE current limit', 'value.current', 'A'),
    num('frequency', 'frequency', 'Grid frequency', 'value', 'Hz'),
    ...phases('power_factors', 'powerFactor', 'Power factor', 'value'),
    str('rfid', 'rfid', 'Last RFID tag'),
    str('rfid_timestamp', 'rfidTimestamp', 'Last RFID tag timestamp'),
    // Not part of the flat mirror, but the daemon mirrors chargepoint's whole raw topic tree
    // (not just get/), so the config topic's own "name" field is reachable under
    // openWB/simpleAPI/chargepoint/<id>/config/name - confirmed live.
    str('config_name', 'configName', 'Chargepoint name', 'text', 'config/name'),
    // Flat mirror calls this "vehicle_name", not "connected_vehicle_name".
    str('connected_vehicle_name', 'connectedVehicleName', 'Connected vehicle name', 'text', 'vehicle_name'),
    // No live MQTT equivalent found - stays HTTP-only for now.
    { ...str('charge_template_name', 'chargeTemplateName', 'Charge template name'), mqttField: undefined },
    // No live MQTT equivalent found (this was a value PHP derives by branching on the active
    // chargemode) - stays HTTP-only for now.
    {
        ...num('min_current', 'minCurrent', 'Minimum current for active mode', 'value.current', 'A'),
        mqttField: undefined,
    },
    // No live MQTT equivalent found under this exact name - stays HTTP-only for now.
    {
        ...num('instant_charging_current', 'instantChargingCurrent', 'Instant charging current', 'value.current', 'A'),
        mqttField: undefined,
    },
    {
        ...num('pv_charging_min_current', 'pvChargingMinCurrent', 'PV charging minimum current', 'value.current', 'A'),
        mqttField: undefined,
    },
    str('instant_charging_limit', 'instantChargingLimit', 'Instant charging limit type'),
    // Flat mirror calls this "instant_charging_limit_amount", not "instant_charging_amount".
    num(
        'instant_charging_amount',
        'instantChargingAmount',
        'Instant charging amount limit',
        'value.energy',
        'kWh',
        'instant_charging_limit_amount',
    ),
    // Flat mirror calls this "instant_charging_limit_soc", not "instant_charging_soc".
    num(
        'instant_charging_soc',
        'instantChargingSoc',
        'Instant charging SoC limit',
        'value.battery',
        '%',
        'instant_charging_limit_soc',
    ),
    // Note: HTTP's max_price_eco is scaled x100000 for legacy reasons (see ParameterHandler.php);
    // the MQTT value is the real, unscaled price. This read-only mirror intentionally shows the
    // unscaled MQTT value - only the HTTP write side (chargepoint.<id>.control.maxPriceEco) uses
    // the x100000 convention, and that's unaffected by this read path.
    num('max_price_eco', 'maxPriceEco', 'ECO mode max price', 'value'),
    // Best-effort mapping, not fully disambiguated live (both this and pro_soc read null on the
    // test device - no vehicle with live SoC data was plugged in): the flat mirror's bare "soc"
    // is inferred to be the *connected vehicle's* SoC (matching this field), by the same
    // naming convention that makes "pro_soc" the chargepoint's own SoC reading.
    num('soc', 'soc', 'Connected vehicle state of charge', 'value.battery', '%'),
    // No flat equivalent - falls back to the nested get/ path.
    num(
        'range_charged',
        'rangeCharged',
        'Range added by charging',
        'value',
        'km',
        'connected_vehicle/soc/range_charged',
    ),
    str('chargemode', 'chargemode', 'Current chargemode'),
    bool('manual_lock', 'manualLock', 'Manually locked'),
];

export const CHARGEPOINT_CONTROL_FIELDS: WriteFieldDef[] = [
    {
        stateId: 'chargemode',
        name: 'Chargemode',
        type: 'string',
        role: 'state',
        writeParam: 'set_chargemode',
        idParam: 'chargepoint_nr',
        states: { instant: 'instant', pv: 'pv', eco: 'eco', stop: 'stop', target: 'target' },
    },
    {
        stateId: 'chargecurrent',
        name: 'Instant charging current',
        type: 'number',
        role: 'level.current',
        unit: 'A',
        writeParam: 'chargecurrent',
        idParam: 'chargepoint_nr',
        min: 0,
        max: 32,
    },
    {
        stateId: 'minimalPvSoc',
        name: 'Minimum PV charging SoC',
        type: 'number',
        role: 'level',
        unit: '%',
        writeParam: 'minimal_pv_soc',
        idParam: 'chargepoint_nr',
        min: 0,
        max: 100,
    },
    {
        stateId: 'minimalPermanentCurrent',
        name: 'Minimum permanent current (PV charging)',
        type: 'number',
        role: 'level.current',
        unit: 'A',
        writeParam: 'minimal_permanent_current',
        idParam: 'chargepoint_nr',
        min: 0,
        max: 32,
    },
    {
        stateId: 'maxPriceEco',
        name: 'ECO mode max price',
        type: 'number',
        role: 'level',
        writeParam: 'max_price_eco',
        idParam: 'chargepoint_nr',
    },
    {
        stateId: 'chargepointLock',
        name: 'Chargepoint locked',
        type: 'boolean',
        role: 'switch',
        writeParam: 'chargepoint_lock',
        idParam: 'chargepoint_nr',
        writeTransform: value => (value ? 1 : 0),
    },
    {
        stateId: 'instantChargingLimit',
        name: 'Instant charging limit type',
        type: 'string',
        role: 'state',
        writeParam: 'instant_charging_limit',
        idParam: 'chargepoint_nr',
        states: { none: 'none', amount: 'amount', soc: 'soc' },
    },
    {
        stateId: 'instantChargingAmount',
        name: 'Instant charging amount limit',
        type: 'number',
        role: 'level.energy',
        unit: 'kWh',
        writeParam: 'instant_charging_amount',
        idParam: 'chargepoint_nr',
        min: 0,
    },
    {
        stateId: 'instantChargingSoc',
        name: 'Instant charging SoC limit',
        type: 'number',
        role: 'level.battery',
        unit: '%',
        writeParam: 'instant_charging_soc',
        idParam: 'chargepoint_nr',
        min: 0,
        max: 100,
    },
    {
        stateId: 'vehicle',
        name: 'Assigned vehicle ID',
        type: 'number',
        role: 'level',
        writeParam: 'vehicle',
        idParam: 'chargepoint_nr',
        min: 0,
    },
];

export interface ControlLiveSource {
    /** matches a CHARGEPOINT_CONTROL_FIELDS entry's stateId */
    controlStateId: string;
    /**
     * Field path relative to openWB/simpleAPI/chargepoint/<id>/ - confirmed live against the exact
     * topic each setXxx() handler in ParameterHandler.php itself reads/writes, not necessarily the
     * same as any CHARGEPOINT_READ_FIELDS entry's mqttField: for instant_charging_limit/_amount/_soc
     * specifically, the flat top-level mirror of the same name was confirmed live to disagree with
     * the nested charge_template value these writes actually touch (e.g. flat "soc"/80 vs. nested
     * "none"/100 on the same real device at the same moment) - using the flat name here would make
     * "does writing confirm the real value" occasionally show the wrong thing.
     */
    mqttField: string;
    type: 'number' | 'string' | 'boolean';
    /** wire value -> control state value, for the fields where units/scale genuinely differ */
    fromMqtt?: (value: unknown) => ioBroker.StateValue;
}

/**
 * Lets the adapter show a live, device-confirmed value for chargepoint control states instead of
 * leaving them null until the user writes something - and, after a write, replaces the optimistic
 * echo (handleControlWrite's own setState) with the real applied value shortly after, since openWB
 * republishes charge_template/config over MQTT on every change regardless of who made it.
 *
 * batMode/batPowerReserve (BATTERY_CONTROL_FIELDS, under battery.<id>.control.*) have no entry
 * here: their setters write to openWB/general/..., a topic root simpleAPI_mqtt.py never mirrors (it
 * only subscribes to bat/pv/chargepoint/counter+consumer) - confirmed by reading
 * ParameterHandler.php's setBatMode/setBatPowerReserve, so there is no live value for those within
 * openWB/simpleAPI/# to bind to. They keep the plain optimistic echo.
 */
export const CHARGEPOINT_CONTROL_LIVE_FIELDS: ControlLiveSource[] = [
    { controlStateId: 'chargemode', mqttField: 'set/charge_template/chargemode/selected', type: 'string' },
    {
        controlStateId: 'chargecurrent',
        mqttField: 'set/charge_template/chargemode/instant_charging/current',
        type: 'number',
    },
    {
        controlStateId: 'minimalPvSoc',
        mqttField: 'set/charge_template/chargemode/pv_charging/min_soc',
        type: 'number',
    },
    {
        controlStateId: 'minimalPermanentCurrent',
        mqttField: 'set/charge_template/chargemode/pv_charging/min_current',
        type: 'number',
    },
    {
        // Same x100000 legacy scale as the HTTP write side (setMaxPriceEco divides by 100000
        // before storing) - see CHARGEPOINT_READ_FIELDS' max_price_eco comment for the read-only
        // mirror's take on the same quirk.
        controlStateId: 'maxPriceEco',
        mqttField: 'set/charge_template/chargemode/eco_charging/max_price',
        type: 'number',
        fromMqtt: value => Math.round(Number(value) * 100000),
    },
    { controlStateId: 'chargepointLock', mqttField: 'manual_lock', type: 'boolean' },
    {
        controlStateId: 'instantChargingLimit',
        mqttField: 'set/charge_template/chargemode/instant_charging/limit/selected',
        type: 'string',
    },
    {
        // setInstantChargingAmount converts kWh -> Wh before writing; convert back for display.
        controlStateId: 'instantChargingAmount',
        mqttField: 'set/charge_template/chargemode/instant_charging/limit/amount',
        type: 'number',
        fromMqtt: value => Number(value) / 1000,
    },
    {
        controlStateId: 'instantChargingSoc',
        mqttField: 'set/charge_template/chargemode/instant_charging/limit/soc',
        type: 'number',
    },
    // setVehicle writes config.ev - not the same field as the read-only vehicle_id (that's the
    // chargepoint's own currently-detected vehicle, a different concept - confirmed live: vehicle_id
    // was null while config/ev was 1 on the same real chargepoint).
    { controlStateId: 'vehicle', mqttField: 'config/ev', type: 'number' },
];

/** Builds a `mqttField -> ControlLiveSource` lookup for routing incoming chargepoint MQTT messages. */
export function buildControlLiveLookup(): Map<string, ControlLiveSource> {
    return new Map(CHARGEPOINT_CONTROL_LIVE_FIELDS.map(field => [field.mqttField, field]));
}

export const COUNTER_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('voltages', 'voltage', 'Voltage', 'value.voltage', 'V'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    ...phases('powers', 'power', 'Power', 'value.power', 'W'),
    ...phases('power_factors', 'powerFactor', 'Power factor', 'value'),
    num('frequency', 'frequency', 'Grid frequency', 'value', 'Hz'),
    // See CHARGEPOINT_READ_FIELDS' imported/exported comment - same Wh-on-the-wire quirk here.
    num('exported', 'exported', 'Energy exported', 'value.energy', 'Wh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'Wh'),
    num('imported', 'imported', 'Energy imported', 'value.energy', 'Wh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'Wh'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
];

export const BATTERY_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    num('soc', 'soc', 'State of charge', 'value.battery', '%'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    num('imported', 'imported', 'Energy imported (discharged)', 'value.energy', 'Wh'),
    num('exported', 'exported', 'Energy exported (charged)', 'value.energy', 'Wh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'Wh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'Wh'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
    bool('power_limit_controllable', 'powerLimitControllable', 'Power limit controllable'),
];

export const PV_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'Wh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'Wh'),
    num('monthly_exported', 'monthlyExported', 'Energy exported this month', 'value.energy', 'Wh'),
    num('yearly_exported', 'yearlyExported', 'Energy exported this year', 'value.energy', 'Wh'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
];

/*
 * Not live-verified - no consumer module was configured on the test device (consumer support
 * needs openWB/core PR #3981 or later, see project memory). mqttField values below are inferred
 * from the same nested `get/<field>` mirroring pattern confirmed for counter/battery/pv, plus the
 * PHP source's own topic layout for usage_type specifically (read from a separate
 * `openWB/consumer/<id>/usage` JSON object, not a `get/usage_type` topic - the daemon's generic
 * flattening would turn that into `usage/type`). Worth re-confirming against a real consumer
 * module before relying on this table.
 */
export const CONSUMER_READ_FIELDS: ReadFieldDef[] = [
    str('usage_type', 'usageType', 'Usage type', 'text', 'usage/type'),
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    ...phases('voltages', 'voltage', 'Voltage', 'value.voltage', 'V'),
    ...phases('powers', 'power', 'Power', 'value.power', 'W'),
    num('imported', 'imported', 'Energy imported', 'value.energy', 'Wh'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'Wh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'Wh'),
    num('phases_in_use', 'phasesInUse', 'Phases in use', 'value'),
    bool('charge_state', 'chargeState', 'Currently active'),
    str('state_str', 'stateStr', 'State'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
];

/**
 * Battery-related control fields, shown under each battery instance's own control channel
 * (battery.<id>.control.*) for consistency with chargepoint's layout - but the underlying writes
 * are still genuinely global (openWB's setBatMode/setBatPowerReserve take no id parameter at all,
 * confirmed from source), so idParam stays unset here regardless of which battery id the state
 * lives under. With more than one battery, each one's control channel reflects/writes the same
 * single global setting.
 */
export const BATTERY_CONTROL_FIELDS: WriteFieldDef[] = [
    {
        stateId: 'batMode',
        name: 'Battery mode',
        type: 'string',
        role: 'state',
        writeParam: 'bat_mode',
        states: { min_soc_bat_mode: 'min_soc_bat_mode', ev_mode: 'ev_mode', bat_mode: 'bat_mode' },
    },
    {
        stateId: 'batPowerReserve',
        name: 'Battery power reserve',
        type: 'number',
        role: 'level.power',
        unit: 'W',
        writeParam: 'bat_power_reserve',
        min: 0,
    },
];

/**
 * Builds an ioBroker `common` object for a read-only field's state.
 *
 * @param field - read field definition
 */
export function commonFromReadField(field: ReadFieldDef): ioBroker.StateCommon {
    const common: ioBroker.StateCommon = {
        name: field.name,
        type: field.type,
        role: field.role,
        read: true,
        write: false,
    };
    if (field.unit) {
        common.unit = field.unit;
    }
    return common;
}

/**
 * Builds an ioBroker `common` object for a writable "control" field's state.
 *
 * @param field - write field definition
 */
export function commonFromWriteField(field: WriteFieldDef): ioBroker.StateCommon {
    const common: ioBroker.StateCommon = {
        name: field.name,
        type: field.type,
        role: field.role,
        read: true,
        write: true,
    };
    if (field.unit) {
        common.unit = field.unit;
    }
    if (field.states) {
        common.states = field.states;
    }
    if (field.min !== undefined) {
        common.min = field.min;
    }
    if (field.max !== undefined) {
        common.max = field.max;
    }
    return common;
}

/**
 * Builds a `mqttField -> ReadFieldDef` lookup for one type's read field table, for routing
 * incoming MQTT messages (parsed via mqttTopics.ts) to the right state. Fields with no
 * `mqttField` (no live MQTT equivalent found) are simply absent from the map.
 *
 * @param fields - one type's read field table (e.g. CHARGEPOINT_READ_FIELDS)
 */
export function buildMqttFieldLookup(fields: ReadFieldDef[]): Map<string, ReadFieldDef> {
    const lookup = new Map<string, ReadFieldDef>();
    for (const field of fields) {
        if (field.mqttField !== undefined) {
            lookup.set(field.mqttField, field);
        }
    }
    return lookup;
}

/**
 * Coerces an already-extracted raw value to a field's declared ioBroker type. Shared by
 * `extractReadValue` (HTTP path, raw comes out of a JSON blob) and `MqttReader` (raw comes out of
 * `normalizeMqttValue`) so both paths apply exactly the same rules.
 *
 * @param raw - raw value, already pulled out of its source structure
 * @param type - the field's declared type
 */
export function coerceFieldValue(raw: unknown, type: 'number' | 'string' | 'boolean'): ioBroker.StateValue {
    switch (type) {
        case 'number': {
            const n = typeof raw === 'number' ? raw : Number(raw);
            return Number.isFinite(n) ? n : 0;
        }
        case 'boolean':
            return Boolean(raw);
        case 'string':
        default:
            if (typeof raw === 'string') {
                return raw;
            }
            // number/boolean stringify meaningfully; anything else (object, undefined, null) has
            // no sensible string form, so fall back to '' rather than risk '[object Object]'.
            return typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '';
    }
}

/**
 * Reads one field's value out of a component's response object (e.g. `data.chargepoint_0`),
 * coercing to the field's declared type. simpleapi.php's handlers always populate every field
 * with a default (0/''/false) rather than omitting it, so missing/null here just means "use the
 * type's zero value" rather than signaling anything about device presence.
 *
 * @param component - the `<type>_<id>` object from a simpleapi.php read response
 * @param field - field definition (see the tables above)
 */
export function extractReadValue(component: Record<string, unknown>, field: ReadFieldDef): ioBroker.StateValue {
    let raw = component[field.sourceField];
    if (field.arrayIndex !== undefined) {
        raw = Array.isArray(raw) ? raw[field.arrayIndex] : undefined;
    }
    return coerceFieldValue(raw, field.type);
}
