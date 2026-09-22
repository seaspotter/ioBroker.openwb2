import { expect } from 'chai';
import {
    parseComponentTable,
    serializeComponentTable,
    enabledIdsByType,
    mergeDiscovered,
    type ComponentTableRow,
} from './componentTable';

describe('parseComponentTable', () => {
    it('returns an empty array for undefined/empty/malformed input', () => {
        expect(parseComponentTable(undefined)).to.deep.equal([]);
        expect(parseComponentTable('')).to.deep.equal([]);
        expect(parseComponentTable('not json')).to.deep.equal([]);
        expect(parseComponentTable('{"not":"an array"}')).to.deep.equal([]);
    });

    it('parses valid rows and drops invalid ones', () => {
        const raw = JSON.stringify([
            { type: 'chargepoint', id: 0, enabled: true },
            { type: 'chargepoint', id: 1, enabled: false },
            { type: 'not-a-real-type', id: 2, enabled: true },
            { type: 'battery', id: -1, enabled: true },
            { type: 'battery' }, // missing id
        ]);

        expect(parseComponentTable(raw)).to.deep.equal([
            { type: 'chargepoint', id: 0, enabled: true, name: undefined },
            { type: 'chargepoint', id: 1, enabled: false, name: undefined },
        ]);
    });

    it('defaults a missing "enabled" field to true', () => {
        const raw = JSON.stringify([{ type: 'chargepoint', id: 0 }]);
        expect(parseComponentTable(raw)).to.deep.equal([
            { type: 'chargepoint', id: 0, enabled: true, name: undefined },
        ]);
    });

    it('carries a user-supplied name through, and drops blank/non-string ones', () => {
        const raw = JSON.stringify([
            { type: 'chargepoint', id: 0, enabled: true, name: 'Interne openWB' },
            { type: 'counter', id: 1, enabled: true, name: '   ' },
            { type: 'counter', id: 2, enabled: true, name: 42 },
        ]);
        expect(parseComponentTable(raw)).to.deep.equal([
            { type: 'chargepoint', id: 0, enabled: true, name: 'Interne openWB' },
            { type: 'counter', id: 1, enabled: true, name: undefined },
            { type: 'counter', id: 2, enabled: true, name: undefined },
        ]);
    });

    it('round-trips through serializeComponentTable', () => {
        const rows: ComponentTableRow[] = [
            { type: 'chargepoint', id: 0, enabled: true, name: 'Interne openWB' },
            { type: 'pv', id: 2, enabled: false },
        ];
        expect(parseComponentTable(serializeComponentTable(rows))).to.deep.equal([
            { type: 'chargepoint', id: 0, enabled: true, name: 'Interne openWB' },
            { type: 'pv', id: 2, enabled: false, name: undefined },
        ]);
    });
});

describe('enabledIdsByType', () => {
    it('includes only enabled rows, sorted', () => {
        const rows: ComponentTableRow[] = [
            { type: 'chargepoint', id: 2, enabled: true },
            { type: 'chargepoint', id: 0, enabled: true },
            { type: 'chargepoint', id: 1, enabled: false },
            { type: 'battery', id: 0, enabled: true },
        ];

        const ids = enabledIdsByType(rows);

        expect(ids.chargepoint).to.deep.equal([0, 2]);
        expect(ids.battery).to.deep.equal([0]);
        expect(ids.pv).to.deep.equal([]);
    });
});

describe('mergeDiscovered', () => {
    it('adds new rows for newly discovered IDs, disabled by default (user must opt in)', () => {
        const existing: ComponentTableRow[] = [{ type: 'chargepoint', id: 0, enabled: true }];

        const { rows, added } = mergeDiscovered(existing, {
            chargepoint: [0, 1],
            counter: [],
            battery: [],
            pv: [],
            consumer: [],
            io: [],
        });

        expect(rows).to.have.deep.members([
            { type: 'chargepoint', id: 0, enabled: true },
            { type: 'chargepoint', id: 1, enabled: false },
        ]);
        expect(added).to.deep.equal([{ type: 'chargepoint', id: 1 }]);
    });

    it('never touches an existing row, even if the user disabled it and discovery reports it again', () => {
        const existing: ComponentTableRow[] = [{ type: 'chargepoint', id: 0, enabled: false }];

        const { rows, added } = mergeDiscovered(existing, {
            chargepoint: [0],
            counter: [],
            battery: [],
            pv: [],
            consumer: [],
            io: [],
        });

        expect(rows).to.deep.equal([{ type: 'chargepoint', id: 0, enabled: false }]);
        expect(added).to.deep.equal([]);
    });

    it('does not remove a row whose ID is no longer reported by discovery', () => {
        const existing: ComponentTableRow[] = [
            { type: 'chargepoint', id: 0, enabled: true },
            { type: 'chargepoint', id: 1, enabled: true },
        ];

        const { rows } = mergeDiscovered(existing, {
            chargepoint: [0], // id 1 no longer reported
            counter: [],
            battery: [],
            pv: [],
            consumer: [],
            io: [],
        });

        expect(rows).to.deep.equal(existing);
    });
});
