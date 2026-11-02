import { expect } from 'chai';
import { freshIds, OBSERVED_STALE_MS } from './mqttReader';

describe('freshIds', () => {
    it('keeps an id last seen exactly at the staleness boundary', () => {
        const observed = new Map([[6, 1000]]);
        expect(freshIds(observed, 1000 + OBSERVED_STALE_MS, OBSERVED_STALE_MS)).to.deep.equal([6]);
    });

    it('drops an id last seen just past the staleness boundary', () => {
        const observed = new Map([[6, 1000]]);
        expect(freshIds(observed, 1000 + OBSERVED_STALE_MS + 1, OBSERVED_STALE_MS)).to.deep.equal([]);
    });

    it('drops a stale id (simulating a component removed from openWB) while keeping a fresh one', () => {
        const now = 10_000_000;
        const observed = new Map([
            [6, now - 1000], // seen a second ago - still real
            [13, now - OBSERVED_STALE_MS - 1], // last seen before the adapter's current connection - gone
        ]);
        expect(freshIds(observed, now, OBSERVED_STALE_MS)).to.deep.equal([6]);
    });

    it('sorts ascending regardless of insertion order', () => {
        const observed = new Map([
            [9, 100],
            [2, 100],
            [5, 100],
        ]);
        expect(freshIds(observed, 100, OBSERVED_STALE_MS)).to.deep.equal([2, 5, 9]);
    });

    it('returns an empty array for an empty map', () => {
        expect(freshIds(new Map(), Date.now(), OBSERVED_STALE_MS)).to.deep.equal([]);
    });
});
