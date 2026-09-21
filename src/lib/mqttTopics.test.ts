import { expect } from 'chai';
import { parseSimpleApiTopic, parseIoTopic, SIMPLE_API_SUBSCRIBE_FILTERS, IO_SUBSCRIBE_FILTER } from './mqttTopics';

// Every topic below was seen verbatim in a read-only mosquitto_sub capture against a real openWB
// device (see project memory) - not guessed.
describe('parseSimpleApiTopic', () => {
    it('parses a plain nested get/ field (counter/battery/pv/consumer shape)', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/counter/6/get/power')).to.deep.equal({
            type: 'counter',
            id: 6,
            fieldPath: 'power',
        });
    });

    it('strips the get/ prefix so nested and flat mirrors resolve to the same fieldPath', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/chargepoint/4/get/power')).to.deep.equal({
            type: 'chargepoint',
            id: 4,
            fieldPath: 'power',
        });
        expect(parseSimpleApiTopic('openWB/simpleAPI/chargepoint/4/power')).to.deep.equal({
            type: 'chargepoint',
            id: 4,
            fieldPath: 'power',
        });
    });

    it('maps the "bat" wire segment to the internal "battery" type', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/bat/8/get/soc')).to.deep.equal({
            type: 'battery',
            id: 8,
            fieldPath: 'soc',
        });
    });

    it('keeps a multi-segment nested field path intact', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/chargepoint/4/get/connected_vehicle/soc/soc')).to.deep.equal({
            type: 'chargepoint',
            id: 4,
            fieldPath: 'connected_vehicle/soc/soc',
        });
    });

    it('keeps 1-based phase indices intact', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/pv/9/get/currents/1')).to.deep.equal({
            type: 'pv',
            id: 9,
            fieldPath: 'currents/1',
        });
    });

    it('does not match the id-less "lowest ID" convenience mirror', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/chargepoint/get/power')).to.be.undefined;
        expect(parseSimpleApiTopic('openWB/simpleAPI/pv/get/daily_exported')).to.be.undefined;
    });

    it('does not match an unrelated topic', () => {
        expect(parseSimpleApiTopic('openWB/simpleAPI/revision')).to.be.undefined;
        expect(parseSimpleApiTopic('openWB/chargepoint/4/get/power')).to.be.undefined;
    });
});

describe('parseIoTopic', () => {
    it('parses a raw io state topic', () => {
        expect(parseIoTopic('openWB/io/states/0/get/digital_output')).to.deep.equal({
            id: 0,
            fieldPath: 'digital_output',
        });
    });

    it('does not match a non-io topic', () => {
        expect(parseIoTopic('openWB/simpleAPI/chargepoint/4/get/power')).to.be.undefined;
    });
});

describe('subscribe filters', () => {
    it('has one filter per simpleAPI-backed type, using the wire segment names', () => {
        expect(SIMPLE_API_SUBSCRIBE_FILTERS).to.include('openWB/simpleAPI/chargepoint/+/#');
        expect(SIMPLE_API_SUBSCRIBE_FILTERS).to.include('openWB/simpleAPI/bat/+/#');
        expect(SIMPLE_API_SUBSCRIBE_FILTERS).to.include('openWB/simpleAPI/counter/+/#');
        expect(SIMPLE_API_SUBSCRIBE_FILTERS).to.include('openWB/simpleAPI/pv/+/#');
        expect(SIMPLE_API_SUBSCRIBE_FILTERS).to.include('openWB/simpleAPI/consumer/+/#');
    });

    it('IO uses the raw namespace, not openWB/simpleAPI', () => {
        expect(IO_SUBSCRIBE_FILTER).to.equal('openWB/io/states/+/get/#');
    });
});
