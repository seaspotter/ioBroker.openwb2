// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** http or https */
            protocol: 'http' | 'https';
            /** hostname or IP address of the openWB device, without protocol */
            host: string;
            /** TCP port simpleapi.php is served on */
            port: number;
            /** path to simpleapi.php on the openWB webserver */
            basePath: string;
            /** authentication method simpleAPI expects */
            authMethod: 'none' | 'bearer' | 'userpass';
            /** bearer token, used when authMethod is "bearer" */
            token: string;
            /** username, used when authMethod is "userpass" */
            username: string;
            /** password, used when authMethod is "userpass" */
            password: string;
            /** HTTP request timeout in ms */
            requestTimeoutMs: number;
            /** seconds between poll cycles */
            pollIntervalS: number;
            /** max number of simpleapi.php requests kept in flight at once during a poll cycle */
            pollConcurrency: number;
            /** minutes between automatic re-discovery runs */
            discoveryIntervalMin: number;
            /**
             * JSON-encoded ComponentTableRow[] (see lib/componentTable.ts) - the single source of
             * truth for which component IDs are known and enabled. Populated by the admin UI's
             * Components tab, either from a "Probe now" discovery run (requires the openWB core to
             * support list_components, i.e. openWB/core PR #3981 or later) or added by hand, and
             * merged into automatically by the background rediscovery timer when it finds IDs not
             * already present.
             */
            componentTable: string;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
