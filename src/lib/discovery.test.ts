import { expect } from 'chai';
import { discoverComponents } from './discovery';
import type { ComponentTableRow } from './componentTable';
import type { SimpleApiClient, SimpleApiConnectionConfig, SimpleApiResult } from './simpleApiClient';

const CFG: SimpleApiConnectionConfig = {
    protocol: 'http',
    host: 'openwb.local',
    port: 80,
    basePath: '/openWB/simpleAPI/simpleapi.php',
    authMethod: 'none',
};

function fakeClient(readResult: SimpleApiResult<Record<string, unknown>>): SimpleApiClient {
    return { read: () => Promise.resolve(readResult) } as unknown as SimpleApiClient;
}

describe('discoverComponents', () => {
    it('uses list_components when the server understands it', async () => {
        const client = fakeClient({
            ok: true,
            data: { chargepoint: [0, 1], counter: [0], battery: [], pv: [0], consumer: [], io: [] },
        });

        const result = await discoverComponents(client, CFG, []);

        expect(result.source).to.equal('list_components');
        expect(result.ids.chargepoint).to.deep.equal([0, 1]);
        expect(result.ids.pv).to.deep.equal([0]);
    });

    it('falls back to the component table when list_components fails (e.g. core without PR #3981)', async () => {
        const client = fakeClient({ ok: false, error: 'HTTP 400' });
        const table: ComponentTableRow[] = [
            { type: 'chargepoint', id: 0, enabled: true },
            { type: 'chargepoint', id: 1, enabled: true },
            { type: 'battery', id: 0, enabled: true },
            { type: 'pv', id: 0, enabled: false }, // disabled - must not be polled
        ];

        const result = await discoverComponents(client, CFG, table);

        expect(result.source).to.equal('manual');
        expect(result.ids.chargepoint).to.deep.equal([0, 1]);
        expect(result.ids.battery).to.deep.equal([0]);
        expect(result.ids.pv).to.deep.equal([]);
    });

    it('falls back to the component table when the response does not look like a components map', async () => {
        // e.g. a 200 response with a body that isn't shaped like {chargepoint: [...], ...} -
        // list_components succeeded technically, but there's nothing to trust as discovery data.
        const client = fakeClient({ ok: true, data: {} });
        const table: ComponentTableRow[] = [{ type: 'chargepoint', id: 0, enabled: true }];

        const result = await discoverComponents(client, CFG, table);

        expect(result.source).to.equal('manual');
        expect(result.ids.chargepoint).to.deep.equal([0]);
    });
});
