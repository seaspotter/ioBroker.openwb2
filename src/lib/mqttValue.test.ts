import { expect } from 'chai';
import { normalizeMqttValue } from './mqttValue';

// Every value shape below was seen verbatim in a read-only mosquitto_sub capture against a real
// openWB device (see project memory) - not guessed.
describe('normalizeMqttValue', () => {
    it('parses plain numbers', () => {
        expect(normalizeMqttValue('0')).to.equal(0);
        expect(normalizeMqttValue('231.08')).to.equal(231.08);
        expect(normalizeMqttValue('-0.7')).to.equal(-0.7);
        expect(normalizeMqttValue('49.94')).to.equal(49.94);
    });

    it('parses JSON null', () => {
        expect(normalizeMqttValue('null')).to.equal(null);
    });

    it('parses properly JSON-encoded (quoted) strings', () => {
        expect(normalizeMqttValue('"Kein Fehler."')).to.equal('Kein Fehler.');
        expect(normalizeMqttValue('"2.1.9-Alpha.3"')).to.equal('2.1.9-Alpha.3');
    });

    it('maps Python-style capitalized booleans, which are not valid JSON', () => {
        expect(normalizeMqttValue('True')).to.equal(true);
        expect(normalizeMqttValue('False')).to.equal(false);
    });

    it('falls back to the raw string for bare/unquoted values that are not valid JSON', () => {
        expect(normalizeMqttValue('pv_charging')).to.equal('pv_charging');
        expect(normalizeMqttValue('km')).to.equal('km');
        expect(normalizeMqttValue('Kein Fehler.')).to.equal('Kein Fehler.');
        // A bare string containing a space - confirms this isn't naively split on whitespace.
        expect(normalizeMqttValue('Renault Megane')).to.equal('Renault Megane');
    });

    it('parses a JSON object payload (e.g. io digital_output maps)', () => {
        expect(normalizeMqttValue('{"LED1": false, "LED2": false}')).to.deep.equal({ LED1: false, LED2: false });
    });

    it('trims surrounding whitespace before parsing', () => {
        expect(normalizeMqttValue('  42  ')).to.equal(42);
        expect(normalizeMqttValue(' True ')).to.equal(true);
    });
});
