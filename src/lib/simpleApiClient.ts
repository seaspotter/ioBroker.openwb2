import axios, { type AxiosRequestConfig } from 'axios';
import { DEFAULT_REQUEST_TIMEOUT_MS, MAX_TIMER_MS } from './constants';

/**
 * Path to simpleapi.php on the openWB webserver - part of openWB's own install layout, not
 * something that varies per install, so it's a hardcoded constant rather than a config field. If
 * this ever changes upstream, that's an adapter code update, not a per-user setting.
 */
const SIMPLE_API_BASE_PATH = '/openWB/simpleAPI/simpleapi.php';

/** Connection details needed to reach simpleapi.php - a subset of the full adapter config. */
export interface SimpleApiConnectionConfig {
    protocol: 'http' | 'https';
    host: string;
    port: number;
    authMethod: 'none' | 'bearer' | 'userpass';
    token?: string;
    username?: string;
    password?: string;
    requestTimeoutMs?: number;
}

export type SimpleApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Thin HTTP client for openWB's simpleAPI (simpleapi.php). Knows nothing about polling schedules,
 * discovery, or retry policy - that lives in main.ts. Never throws past its own boundary; every
 * method resolves to {ok, ...}.
 */
export class SimpleApiClient {
    public constructor(private readonly log: ioBroker.Log) {}

    /**
     * Issues a GET request for one or more read parameters (see stateDefinitions.ts /
     * discovery.ts for which params exist). simpleapi.php merges $_GET and $_POST into one
     * params array server-side, but reads are conventionally sent as GET.
     *
     * @param cfg - connection details
     * @param params - simpleapi.php read parameters, e.g. `{get_chargepoint_all: 0, battery: 0}`
     */
    public async read(
        cfg: SimpleApiConnectionConfig,
        params: Record<string, string | number>,
    ): Promise<SimpleApiResult<Record<string, unknown>>> {
        try {
            const response = await axios.get(this.buildUrl(cfg), {
                ...this.buildRequestOptions(cfg),
                params: { ...params, ...this.authParams(cfg) },
            });
            return this.interpretResponse(response.status, response.data);
        } catch (err) {
            return { ok: false, error: this.sanitizeError(err) };
        }
    }

    /**
     * Issues a POST request for a single write parameter, e.g. `{set_chargemode: 'pv',
     * chargepoint_nr: 0}`. Values are sent as a form-urlencoded body, matching what
     * simpleapi.php reads via PHP's `$_POST`.
     *
     * @param cfg - connection details
     * @param params - simpleapi.php write parameters plus whichever id field it needs
     */
    public async write(
        cfg: SimpleApiConnectionConfig,
        params: Record<string, string | number>,
    ): Promise<SimpleApiResult<Record<string, unknown>>> {
        try {
            const body = new URLSearchParams();
            for (const [key, value] of Object.entries({ ...params, ...this.authParams(cfg) })) {
                body.append(key, String(value));
            }
            const response = await axios.post(this.buildUrl(cfg), body, this.buildRequestOptions(cfg));
            return this.interpretResponse(response.status, response.data);
        } catch (err) {
            return { ok: false, error: this.sanitizeError(err) };
        }
    }

    /**
     * simpleapi.php responds 200 with `{success: false, message}` for some error cases (e.g. auth
     * failure) rather than a non-2xx status, so a 2xx response body still needs checking.
     *
     * @param status - HTTP status code
     * @param data - parsed JSON response body
     */
    private interpretResponse(status: number, data: unknown): SimpleApiResult<Record<string, unknown>> {
        if (status < 200 || status >= 300) {
            return { ok: false, error: `HTTP ${status}` };
        }
        if (data && typeof data === 'object' && (data as { success?: unknown }).success === false) {
            const message = (data as { message?: unknown }).message;
            return { ok: false, error: typeof message === 'string' ? message : 'Request failed' };
        }
        return { ok: true, data: (data ?? {}) as Record<string, unknown> };
    }

    /**
     * Builds the full request URL from the connection config.
     *
     * @param cfg - connection details
     */
    private buildUrl(cfg: SimpleApiConnectionConfig): string {
        return `${cfg.protocol}://${cfg.host}:${cfg.port}${SIMPLE_API_BASE_PATH}`;
    }

    /**
     * Builds the axios request options (timeout, bearer auth header) shared by read and write.
     *
     * @param cfg - connection details
     */
    private buildRequestOptions(cfg: SimpleApiConnectionConfig): AxiosRequestConfig {
        const options: AxiosRequestConfig = {
            timeout: this.resolveTimeout(cfg.requestTimeoutMs),
        };
        if (cfg.authMethod === 'bearer' && cfg.token) {
            options.headers = { Authorization: `Bearer ${cfg.token}` };
        }
        return options;
    }

    /**
     * Extra params to merge in for userpass auth - simpleapi.php reads these from
     * $_GET/$_POST, not HTTP Basic auth.
     *
     * @param cfg - connection details
     */
    private authParams(cfg: SimpleApiConnectionConfig): Record<string, string> {
        if (cfg.authMethod === 'userpass' && cfg.username) {
            return { username: cfg.username, password: cfg.password ?? '' };
        }
        return {};
    }

    /**
     * Validates requestTimeoutMs against Node's setTimeout/setInterval max delay (2^31 - 1 ms) -
     * an out-of-range or invalid value (e.g. tampered admin UI input) would otherwise produce
     * unpredictable axios timeout behavior instead of the expected timeout.
     *
     * @param raw - raw requestTimeoutMs config value
     */
    private resolveTimeout(raw: number | undefined): number {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_TIMER_MS) {
            return DEFAULT_REQUEST_TIMEOUT_MS;
        }
        return raw;
    }

    /**
     * Reduces an axios error down to a short, safe summary for logging - never the Authorization
     * header, bearer token, or password (which may be embedded in the request URL/body for
     * userpass auth).
     *
     * @param err - error thrown by axios
     */
    public sanitizeError(err: unknown): string {
        if (axios.isAxiosError(err)) {
            if (err.response) {
                const body = typeof err.response.data === 'string' ? err.response.data.slice(0, 200) : '';
                return `HTTP ${err.response.status}${body ? `: ${body}` : ''}`;
            }
            if (err.code) {
                return `${err.code}: ${err.message}`;
            }
            return err.message;
        }
        if (err instanceof Error) {
            return err.message;
        }
        return String(err);
    }
}
