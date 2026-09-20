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

function num(sourceField: string, stateId: string, name: string, role: string, unit?: string): ReadFieldDef {
    return { sourceField, stateId, name, type: 'number', role, unit };
}

function str(sourceField: string, stateId: string, name: string, role = 'text'): ReadFieldDef {
    return { sourceField, stateId, name, type: 'string', role };
}

function bool(sourceField: string, stateId: string, name: string, role = 'indicator'): ReadFieldDef {
    return { sourceField, stateId, name, type: 'boolean', role };
}

/**
 * Expands an array-valued source field (e.g. "voltages") into one ReadFieldDef per phase.
 *
 * @param sourceField
 * @param stateIdPrefix
 * @param namePrefix
 * @param role
 * @param unit
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
        stateId: `${stateIdPrefix}_p${i + 1}`,
        name: `${namePrefix} phase ${i + 1}`,
        type: 'number' as const,
        role,
        unit,
    }));
}

export const CHARGEPOINT_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('voltages', 'voltage', 'Voltage', 'value.voltage', 'V'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    ...phases('powers', 'power', 'Power', 'value.power', 'W'),
    str('state_str', 'stateStr', 'State'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
    num('imported', 'imported', 'Energy imported', 'value.energy', 'kWh'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'kWh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'kWh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'kWh'),
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
    str('config_name', 'configName', 'Chargepoint name'),
    str('connected_vehicle_name', 'connectedVehicleName', 'Connected vehicle name'),
    str('charge_template_name', 'chargeTemplateName', 'Charge template name'),
    num('min_current', 'minCurrent', 'Minimum current for active mode', 'value.current', 'A'),
    num('instant_charging_current', 'instantChargingCurrent', 'Instant charging current', 'value.current', 'A'),
    num('pv_charging_min_current', 'pvChargingMinCurrent', 'PV charging minimum current', 'value.current', 'A'),
    str('instant_charging_limit', 'instantChargingLimit', 'Instant charging limit type'),
    num('instant_charging_amount', 'instantChargingAmount', 'Instant charging amount limit', 'value.energy', 'kWh'),
    num('instant_charging_soc', 'instantChargingSoc', 'Instant charging SoC limit', 'value.battery', '%'),
    num('max_price_eco', 'maxPriceEco', 'ECO mode max price', 'value'),
    num('soc', 'soc', 'Connected vehicle state of charge', 'value.battery', '%'),
    num('range_charged', 'rangeCharged', 'Range added by charging', 'value', 'km'),
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
    {
        stateId: 'manualSoc',
        name: 'Manual state of charge',
        type: 'number',
        role: 'level.battery',
        unit: '%',
        writeParam: 'manual_soc',
        idParam: 'chargepoint_nr',
        min: 0,
        max: 100,
    },
];

export const COUNTER_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('voltages', 'voltage', 'Voltage', 'value.voltage', 'V'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    ...phases('powers', 'power', 'Power', 'value.power', 'W'),
    ...phases('power_factors', 'powerFactor', 'Power factor', 'value'),
    num('frequency', 'frequency', 'Grid frequency', 'value', 'Hz'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'kWh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'kWh'),
    num('imported', 'imported', 'Energy imported', 'value.energy', 'kWh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'kWh'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
];

export const BATTERY_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    num('soc', 'soc', 'State of charge', 'value.battery', '%'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    num('imported', 'imported', 'Energy imported (discharged)', 'value.energy', 'kWh'),
    num('exported', 'exported', 'Energy exported (charged)', 'value.energy', 'kWh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'kWh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'kWh'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
    bool('power_limit_controllable', 'powerLimitControllable', 'Power limit controllable'),
];

export const PV_READ_FIELDS: ReadFieldDef[] = [
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'kWh'),
    num('daily_exported', 'dailyExported', 'Energy exported today', 'value.energy', 'kWh'),
    num('monthly_exported', 'monthlyExported', 'Energy exported this month', 'value.energy', 'kWh'),
    num('yearly_exported', 'yearlyExported', 'Energy exported this year', 'value.energy', 'kWh'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
];

export const CONSUMER_READ_FIELDS: ReadFieldDef[] = [
    str('usage_type', 'usageType', 'Usage type'),
    num('power', 'power', 'Power', 'value.power', 'W'),
    ...phases('currents', 'current', 'Current', 'value.current', 'A'),
    ...phases('voltages', 'voltage', 'Voltage', 'value.voltage', 'V'),
    ...phases('powers', 'power', 'Power', 'value.power', 'W'),
    num('imported', 'imported', 'Energy imported', 'value.energy', 'kWh'),
    num('exported', 'exported', 'Energy exported', 'value.energy', 'kWh'),
    num('daily_imported', 'dailyImported', 'Energy imported today', 'value.energy', 'kWh'),
    num('phases_in_use', 'phasesInUse', 'Phases in use', 'value'),
    bool('charge_state', 'chargeState', 'Currently active'),
    str('state_str', 'stateStr', 'State'),
    str('fault_str', 'faultStr', 'Fault'),
    num('fault_state', 'faultState', 'Fault state', 'value'),
];

/** Global (not per-instance) writable fields - see project memory: bat_mode/bat_power_reserve take no id. */
export const GENERAL_CONTROL_FIELDS: WriteFieldDef[] = [
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

    switch (field.type) {
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
            // number/boolean stringify meaningfully; anything else (object, undefined, null -
            // shouldn't happen given simpleapi.php's response shapes, but not guaranteed) has no
            // sensible string form, so fall back to '' rather than risk '[object Object]'.
            return typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '';
    }
}
