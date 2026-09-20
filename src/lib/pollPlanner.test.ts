import { expect } from 'chai';
import { buildPollPlan } from './pollPlanner';
import type { ComponentIds } from './discovery';

function ids(partial: Partial<ComponentIds>): ComponentIds {
    return {
        chargepoint: [],
        counter: [],
        battery: [],
        pv: [],
        consumer: [],
        io: [],
        ...partial,
    };
}

describe('pollPlanner', () => {
    it('returns no requests when nothing is discovered', () => {
        expect(buildPollPlan(ids({}))).to.deep.equal([]);
    });

    it('combines one instance of each different type into a single request', () => {
        const plan = buildPollPlan(ids({ chargepoint: [0], battery: [0], pv: [0], counter: [0] }));

        expect(plan).to.have.lengthOf(1);
        expect(plan[0].params).to.deep.equal({
            get_chargepoint_all: 0,
            battery: 0,
            pv: 0,
            get_counter: 0,
        });
        expect(plan[0].components).to.have.deep.members([
            { type: 'chargepoint', id: 0 },
            { type: 'battery', id: 0 },
            { type: 'pv', id: 0 },
            { type: 'counter', id: 0 },
        ]);
    });

    it('never puts two instances of the same type in one request (simpleapi.php keeps only the last value for a repeated param)', () => {
        const plan = buildPollPlan(ids({ chargepoint: [0, 1, 2] }));

        expect(plan).to.have.lengthOf(3);
        for (const request of plan) {
            expect(Object.keys(request.params)).to.have.lengthOf(1);
        }
        expect(plan.map(r => r.params.get_chargepoint_all)).to.deep.equal([0, 1, 2]);
    });

    it('round-robins mismatched counts across the minimum number of requests', () => {
        const plan = buildPollPlan(ids({ chargepoint: [0, 1, 2], battery: [0] }));

        expect(plan).to.have.lengthOf(3);
        expect(plan[0].params).to.deep.equal({ get_chargepoint_all: 0, battery: 0 });
        expect(plan[1].params).to.deep.equal({ get_chargepoint_all: 1 });
        expect(plan[2].params).to.deep.equal({ get_chargepoint_all: 2 });
    });
});
