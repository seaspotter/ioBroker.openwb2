import { expect } from 'chai';
import {
    CHARGEPOINT_READ_FIELDS,
    CHARGEPOINT_CONTROL_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    BATTERY_CONTROL_FIELDS,
    extractReadValue,
    coerceFieldValue,
    buildMqttFieldLookup,
    commonFromReadField,
    commonFromWriteField,
} from './stateDefinitions';

// A realistic chargepoint_0 payload shaped exactly like ParameterHandler.php's getChargepointAll().
const SAMPLE_CHARGEPOINT = {
    power: 0,
    voltages: [237.79, 0, 0],
    currents: [0, 0, 0],
    powers: [0, 0, 0],
    state_str: 'Nicht bereit',
    fault_str: 'Kein Fehler',
    fault_state: 0,
    imported: 1125.57,
    exported: 0,
    daily_imported: 0,
    daily_exported: 0,
    phases_in_use: 1,
    plug_state: false,
    charge_state: false,
    pro_soc: 0,
    soc_timestamp: null,
    vehicle_id: 3,
    evse_current: 0,
    frequency: 0,
    power_factors: [0, 0, 0],
    rfid: null,
    rfid_timestamp: null,
    config_name: 'Garage',
    connected_vehicle_name: 'Model 3',
    charge_template_name: 'Standard',
    min_current: 6,
    instant_charging_current: 10,
    pv_charging_min_current: 6,
    instant_charging_limit: 'none',
    instant_charging_amount: 0,
    instant_charging_soc: 0,
    max_price_eco: 0,
    soc: 55,
    range_charged: 12.5,
    chargemode: 'pv_charging',
    manual_lock: false,
};

describe('extractReadValue', () => {
    it('reads a plain numeric field', () => {
        const field = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'power')!;
        expect(extractReadValue(SAMPLE_CHARGEPOINT, field)).to.equal(0);
    });

    it('extracts one phase out of an array field', () => {
        const p1 = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'voltage_p1')!;
        const p2 = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'voltage_p2')!;
        expect(extractReadValue(SAMPLE_CHARGEPOINT, p1)).to.equal(237.79);
        expect(extractReadValue(SAMPLE_CHARGEPOINT, p2)).to.equal(0);
    });

    it('reads a string field, defaulting null to an empty string', () => {
        const stateStr = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'stateStr')!;
        const rfid = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'rfid')!;
        expect(extractReadValue(SAMPLE_CHARGEPOINT, stateStr)).to.equal('Nicht bereit');
        expect(extractReadValue(SAMPLE_CHARGEPOINT, rfid)).to.equal('');
    });

    it('reads a boolean field', () => {
        const chargeState = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'chargeState')!;
        expect(extractReadValue({ ...SAMPLE_CHARGEPOINT, charge_state: true }, chargeState)).to.equal(true);
        expect(extractReadValue(SAMPLE_CHARGEPOINT, chargeState)).to.equal(false);
    });

    it('keeps pro_soc (chargepoint-reported) and soc (connected vehicle) distinct', () => {
        const proSoc = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'proSoc')!;
        const soc = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'soc')!;
        expect(extractReadValue(SAMPLE_CHARGEPOINT, proSoc)).to.equal(0);
        expect(extractReadValue(SAMPLE_CHARGEPOINT, soc)).to.equal(55);
    });
});

describe('coerceFieldValue', () => {
    it('coerces to a number, defaulting non-finite to 0', () => {
        expect(coerceFieldValue(231.08, 'number')).to.equal(231.08);
        expect(coerceFieldValue('231.08', 'number')).to.equal(231.08);
        expect(coerceFieldValue(null, 'number')).to.equal(0);
        expect(coerceFieldValue('not a number', 'number')).to.equal(0);
    });

    it('coerces to a boolean', () => {
        expect(coerceFieldValue(true, 'boolean')).to.equal(true);
        expect(coerceFieldValue(0, 'boolean')).to.equal(false);
    });

    it('coerces to a string, preferring an already-string value verbatim', () => {
        expect(coerceFieldValue('Kein Fehler.', 'string')).to.equal('Kein Fehler.');
        expect(coerceFieldValue(42, 'string')).to.equal('42');
        expect(coerceFieldValue(null, 'string')).to.equal('');
    });
});

describe('buildMqttFieldLookup', () => {
    it('maps mqttField -> field def, one entry per mapped field', () => {
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('power')?.stateId).to.equal('power');
        expect(lookup.get('voltages/1')?.stateId).to.equal('voltage_p1');
        // chargemode's flat-mirror mqttField is the same name, not the sourceField-default path
        expect(lookup.get('chargemode')?.stateId).to.equal('chargemode');
    });

    it('omits fields with no mqttField (no live MQTT equivalent found)', () => {
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        const chargeTemplateName = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'chargeTemplateName')!;
        expect(chargeTemplateName.mqttField).to.be.undefined;
        expect([...lookup.values()]).to.not.include(chargeTemplateName);
    });

    it('maps configName to the config topic, not the flat get/ mirror', () => {
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('config/name')?.stateId).to.equal('configName');
    });
});

describe('field tables', () => {
    const readTables = {
        chargepoint: CHARGEPOINT_READ_FIELDS,
        counter: COUNTER_READ_FIELDS,
        battery: BATTERY_READ_FIELDS,
        pv: PV_READ_FIELDS,
        consumer: CONSUMER_READ_FIELDS,
    };

    for (const [type, fields] of Object.entries(readTables)) {
        it(`${type}: every stateId is unique`, () => {
            const ids = fields.map(f => f.stateId);
            expect(new Set(ids).size).to.equal(ids.length);
        });

        it(`${type}: every field produces a valid read-only common object`, () => {
            for (const field of fields) {
                const common = commonFromReadField(field);
                expect(common.write).to.equal(false);
                expect(common.type).to.equal(field.type);
            }
        });
    }

    it('chargepoint control fields all target chargepoint_nr and produce writable commons', () => {
        for (const field of CHARGEPOINT_CONTROL_FIELDS) {
            expect(field.idParam).to.equal('chargepoint_nr');
            expect(commonFromWriteField(field).write).to.equal(true);
        }
    });

    it('battery control fields take no id (bat_mode/bat_power_reserve are global)', () => {
        for (const field of BATTERY_CONTROL_FIELDS) {
            expect(field.idParam).to.be.undefined;
        }
    });

    it('chargepointLock write-transforms a boolean into 0/1', () => {
        const field = CHARGEPOINT_CONTROL_FIELDS.find(f => f.stateId === 'chargepointLock')!;
        expect(field.writeTransform!(true)).to.equal(1);
        expect(field.writeTransform!(false)).to.equal(0);
    });
});
