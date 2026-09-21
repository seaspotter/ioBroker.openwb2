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
            /** HTTP request timeout in ms - still used for writes (control states) and Test connection */
            requestTimeoutMs: number;
            /** hostname or IP address of the openWB MQTT broker - usually the same device as `host` */
            mqttHost: string;
            /** MQTT broker port (1883 unauthenticated is what openWB exposes by default) */
            mqttPort: number;
            /** MQTT broker username, if the broker requires auth */
            mqttUsername: string;
            /** MQTT broker password, if the broker requires auth */
            mqttPassword: string;
            /** minutes between automatic checks for newly-observed component IDs (see MqttReader) */
            discoveryIntervalMin: number;
            /**
             * JSON-encoded ComponentTableRow[] (see lib/componentTable.ts) - the single source of
             * truth for which component IDs are known and enabled. Populated by the admin UI's
             * Components tab, either from a "Probe now" run (reads MqttReader's already-observed
             * IDs, no network round-trip needed) or added by hand, and merged into automatically by
             * the background rediscovery timer when it finds IDs not already present.
             */
            componentTable: string;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
