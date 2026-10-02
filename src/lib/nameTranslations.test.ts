import { expect } from 'chai';
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
    type ReadFieldDef,
    type WriteFieldDef,
} from './stateDefinitions';
import { translated, translatedComponentLabel, translatedPhase, COMPONENT_TYPE_NAMES } from './nameTranslations';
import { COMPONENT_TYPES } from './constants';

const LANGUAGES: ioBroker.Languages[] = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

/**
 * @param name - the Translated object under test
 * @param label - identifies which field failed, for the assertion message
 */
function expectFullyTranslated(name: ioBroker.Translated, label: string): void {
    for (const lang of LANGUAGES) {
        expect(name[lang], `${label} missing "${lang}"`).to.be.a('string').that.is.not.empty;
    }
}

describe('field table name translations', () => {
    const readTables: Record<string, ReadFieldDef[]> = {
        chargepoint: CHARGEPOINT_READ_FIELDS,
        counter: COUNTER_READ_FIELDS,
        battery: BATTERY_READ_FIELDS,
        pv: PV_READ_FIELDS,
        pvTotal: PV_TOTAL_READ_FIELDS,
        chargepointTotal: CHARGEPOINT_TOTAL_READ_FIELDS,
        homeConsumption: HOME_CONSUMPTION_READ_FIELDS,
        consumer: CONSUMER_READ_FIELDS,
    };
    const writeTables: Record<string, WriteFieldDef[]> = {
        chargepointControl: CHARGEPOINT_CONTROL_FIELDS,
        batteryControl: BATTERY_CONTROL_FIELDS,
    };

    for (const [table, fields] of Object.entries(readTables)) {
        it(`${table}: every field name is fully translated`, () => {
            for (const field of fields) {
                expectFullyTranslated(field.name, `${table}.${field.stateId}`);
            }
        });
    }

    for (const [table, fields] of Object.entries(writeTables)) {
        it(`${table}: every field name is fully translated`, () => {
            for (const field of fields) {
                expectFullyTranslated(field.name, `${table}.${field.stateId}`);
            }
        });
    }
});

describe('translated', () => {
    it('throws for a string with no dictionary entry', () => {
        expect(() => translated('Not a real field name')).to.throw(/Missing translation/);
    });

    it('always includes the requested English text verbatim', () => {
        expect(translated('Power').en).to.equal('Power');
    });
});

describe('translatedPhase', () => {
    it('composes a fully translated per-phase name', () => {
        expectFullyTranslated(translatedPhase('Voltage', 1), 'translatedPhase(Voltage, 1)');
        expect(translatedPhase('Voltage', 1).en).to.equal('Voltage phase 1');
        expect(translatedPhase('Voltage', 2).de).to.equal('Spannung Phase 2');
    });

    it('compounds Chinese without spaces', () => {
        expect(translatedPhase('Current', 3)['zh-cn']).to.equal('电流相3');
    });
});

describe('COMPONENT_TYPE_NAMES / translatedComponentLabel', () => {
    it('has a fully translated word for every component type', () => {
        for (const type of COMPONENT_TYPES) {
            expectFullyTranslated(COMPONENT_TYPE_NAMES[type], `COMPONENT_TYPE_NAMES.${type}`);
        }
    });

    it('composes a fully translated default channel label', () => {
        const label = translatedComponentLabel('chargepoint', 0);
        expectFullyTranslated(label, 'translatedComponentLabel(chargepoint, 0)');
        expect(label.en).to.equal('chargepoint 0');
        expect(label.de).to.equal('Ladepunkt 0');
    });
});

describe('channel-level names used directly by main.ts', () => {
    it('Control, Home consumption, and both Total channels are fully translated', () => {
        expectFullyTranslated(translated('Control'), 'Control');
        expectFullyTranslated(translated('Home consumption (estimated)'), 'Home consumption (estimated)');
        expectFullyTranslated(translated('Total pv'), 'Total pv');
        expectFullyTranslated(translated('Total chargepoint'), 'Total chargepoint');
    });
});
