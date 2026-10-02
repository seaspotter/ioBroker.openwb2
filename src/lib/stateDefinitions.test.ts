import { expect } from 'chai';
import type { ReadFieldDef } from './stateDefinitions';
import {
    CHARGEPOINT_READ_FIELDS,
    CHARGEPOINT_CONTROL_FIELDS,
    COUNTER_READ_FIELDS,
    BATTERY_READ_FIELDS,
    PV_READ_FIELDS,
    CONSUMER_READ_FIELDS,
    BATTERY_CONTROL_FIELDS,
    coerceFieldValue,
    buildMqttFieldLookup,
    commonFromReadField,
    commonFromWriteField,
    scaleEnergyValue,
} from './stateDefinitions';

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
        expect(lookup.get('chargemode')?.stateId).to.equal('chargemode');
    });

    it('omits fields with no mqttField (no live MQTT equivalent found)', () => {
        const withoutMqtt: ReadFieldDef = {
            stateId: 'noMqttField',
            name: { en: 'No MQTT field' },
            type: 'string',
            role: 'text',
            mqttField: undefined,
        };
        const lookup = buildMqttFieldLookup([withoutMqtt]);
        expect(lookup.size).to.equal(0);
    });

    it('scales maxPriceEco from EUR/Wh (wire) to ct/kWh (displayed), matching the writable control', () => {
        const field = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'maxPriceEco')!;
        expect(field.unit).to.equal('ct/kWh');
        expect(field.fromMqtt!(0.0002)).to.equal(20);
    });

    it('maps pvChargingMinCurrent to the simpleAPI-published minimal_permanent_current topic', () => {
        // Confirmed against simpleAPI_mqtt.py's _publish_charge_template_read_topics(): it
        // republishes chargemode.pv_charging.min_current under "minimal_permanent_current"
        // (matching the writable pvChargingMinCurrent control's naming), not
        // "pv_charging_min_current".
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('minimal_permanent_current')?.stateId).to.equal('pvChargingMinCurrent');
    });

    it('has no field at all for minCurrent, evseCurrent, evseSignaling, maxEvseCurrent or vehicleId', () => {
        // minCurrent: no topic of its own anywhere, inside or outside openWB/simpleAPI - PHP derives
        // it by branching on the active chargemode. The other four are confirmed-live, mapped
        // fields that were dropped as genuinely not needed, not because they're unavailable.
        const removedStateIds = ['minCurrent', 'evseCurrent', 'evseSignaling', 'maxEvseCurrent', 'vehicleId'];
        const presentStateIds = CHARGEPOINT_READ_FIELDS.map(f => f.stateId);
        for (const stateId of removedStateIds) {
            expect(presentStateIds).to.not.include(stateId);
        }
    });

    it('maps chargeTemplateName/instantChargingCurrent to the set/charge_template sub-tree, confirmed live under openWB/simpleAPI', () => {
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('set/charge_template/name')?.stateId).to.equal('chargeTemplateName');
        expect(lookup.get('set/charge_template/chargemode/instant_charging/current')?.stateId).to.equal(
            'instantChargingCurrent',
        );
    });

    it('maps pvChargingLimit/Amount/Soc to the not-yet-upstream simpleAPI field names', () => {
        // Not on mainline openWB/core yet - see CHARGEPOINT_READ_FIELDS' comment above these
        // entries. Same field names the writable pvChargingLimit/Amount/Soc controls' upstream
        // write support assumes will land.
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('pv_charging_limit')?.stateId).to.equal('pvChargingLimit');
        expect(lookup.get('pv_charging_limit_amount')?.stateId).to.equal('pvChargingAmount');
        expect(lookup.get('pv_charging_limit_soc')?.stateId).to.equal('pvChargingSoc');
    });

    it('maps configName to the config topic, not the flat get/ mirror', () => {
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('config/name')?.stateId).to.equal('configName');
    });

    it('maps soc/socTimestamp to the "soc.*" sub-object alias, not the flat bare fields (which read empty live)', () => {
        const lookup = buildMqttFieldLookup(CHARGEPOINT_READ_FIELDS);
        expect(lookup.get('soc/soc')?.stateId).to.equal('soc');
        expect(lookup.get('soc/timestamp')?.stateId).to.equal('socTimestamp');
        expect(lookup.has('soc')).to.equal(false);
        expect(lookup.has('soc_timestamp')).to.equal(false);
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

    it('every chargepoint/counter/battery/pv/consumer cumulative energy field uses literal unit "Wh"', () => {
        // scaleEnergyValue/commonFromReadField's energyUnit conversion keys off this exact literal
        // string - a field meant to be converted that used some other casing/spelling would
        // silently never get scaled.
        const allFields = [
            ...CHARGEPOINT_READ_FIELDS,
            ...COUNTER_READ_FIELDS,
            ...BATTERY_READ_FIELDS,
            ...PV_READ_FIELDS,
            ...CONSUMER_READ_FIELDS,
        ];
        const energyFields = allFields.filter(f => f.role === 'value.energy');
        expect(energyFields.length).to.be.greaterThan(0);
        for (const field of energyFields) {
            // instantChargingAmount/pvChargingAmount are value.energy but natively kWh, not Wh -
            // they're a configured limit, not a cumulative wire meter, and must NOT be scaled.
            if (field.stateId === 'instantChargingAmount' || field.stateId === 'pvChargingAmount') {
                expect(field.unit).to.equal('kWh');
            } else {
                expect(field.unit, field.stateId).to.equal('Wh');
            }
        }
    });

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

describe('scaleEnergyValue', () => {
    const whField = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'imported')!;
    const nonEnergyField = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'power')!;

    it('leaves the value untouched when energyUnit is Wh (the default)', () => {
        expect(scaleEnergyValue(whField, 12345, 'Wh')).to.equal(12345);
    });

    it('converts to kWh and rounds to 2 decimal places when energyUnit is kWh', () => {
        expect(scaleEnergyValue(whField, 12345, 'kWh')).to.equal(12.35);
        expect(scaleEnergyValue(whField, 1000, 'kWh')).to.equal(1);
        expect(scaleEnergyValue(whField, 0, 'kWh')).to.equal(0);
    });

    it('leaves non-Wh fields untouched regardless of energyUnit', () => {
        expect(scaleEnergyValue(nonEnergyField, 2300, 'kWh')).to.equal(2300);
    });

    it('leaves non-numeric values untouched (null/undefined/string)', () => {
        expect(scaleEnergyValue(whField, null, 'kWh')).to.equal(null);
        expect(scaleEnergyValue(whField, undefined as unknown as null, 'kWh')).to.equal(undefined);
    });
});

describe('commonFromReadField energyUnit handling', () => {
    const whField = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'imported')!;

    it('defaults to the field\'s native "Wh" unit when energyUnit is omitted', () => {
        expect(commonFromReadField(whField).unit).to.equal('Wh');
    });

    it('overrides the unit to "kWh" when energyUnit is "kWh"', () => {
        expect(commonFromReadField(whField, 'kWh').unit).to.equal('kWh');
    });

    it('never changes a field whose native unit is not "Wh" (e.g. instantChargingAmount, kWh already)', () => {
        const kwhField = CHARGEPOINT_READ_FIELDS.find(f => f.stateId === 'instantChargingAmount')!;
        expect(commonFromReadField(kwhField, 'kWh').unit).to.equal('kWh');
        expect(commonFromReadField(kwhField, 'Wh').unit).to.equal('kWh');
    });
});
