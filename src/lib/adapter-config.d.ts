// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            /** http or https, for the HTTP (write) side */
            protocol: 'http' | 'https';
            /**
             * hostname or IP address of the openWB device - shared by both the HTTP (write) side
             * and the MQTT (read) side, since it's the same device in every real setup verified so
             * far. simpleapi.php's own path is a fixed, hardcoded constant (see
             * SIMPLE_API_BASE_PATH in simpleApiClient.ts) - not user-configurable, since it's part
             * of openWB's own install layout, not something that varies per install.
             */
            host: string;
            /** TCP port simpleapi.php is served on */
            port: number;
            /** authentication method simpleAPI expects - confirmed via source that there's no
             * openWB GUI to set this up (config.php is filesystem-edit only), so this is a rarely
             * used, secondary option, not the default path. */
            authMethod: 'none' | 'bearer' | 'userpass';
            /** bearer token, used when authMethod is "bearer" */
            token: string;
            /** username, used when authMethod is "userpass" */
            username: string;
            /** password, used when authMethod is "userpass" */
            password: string;
            /** HTTP request timeout in ms - still used for writes (control states) and Test connection */
            requestTimeoutMs: number;
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
