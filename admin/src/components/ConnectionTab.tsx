import React from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';

import { I18n, type AdminConnection } from '@iobroker/adapter-react-v5';

import { asString, asNumber } from '../nativeUtils';

export interface ConnectionTabProps {
    native: Record<string, unknown>;
    onChange: (attr: string, value: unknown) => void;
    socket: AdminConnection;
    instanceId: string;
    onToast: (text: string) => void;
}

interface ConnectionTabState {
    testing: boolean;
    testResult?: { http: { ok: boolean; error?: string }; mqtt: { ok: boolean; error?: string } };
}

/**
 * A single Host/IP drives both the HTTP (write) side and the MQTT (read) side - verified against
 * real setups, it's always the same device. simpleapi.php's own path is a fixed constant (see
 * SIMPLE_API_BASE_PATH in src/lib/simpleApiClient.ts), not shown here at all. Authentication (for
 * either side) is real but rarely usable in practice - openWB has no GUI to set up simpleAPI
 * tokens/users or MQTT broker credentials, only filesystem-edit-only config files - so it's tucked
 * under "Advanced", not front and center.
 */
export default class ConnectionTab extends React.Component<ConnectionTabProps, ConnectionTabState> {
    public constructor(props: ConnectionTabProps) {
        super(props);
        this.state = { testing: false };
    }

    private testConnection = async (): Promise<void> => {
        const { native, socket, instanceId } = this.props;
        this.setState({ testing: true, testResult: undefined });
        const response = await socket.sendTo(instanceId, 'testConnection', {
            protocol: native.protocol,
            host: native.host,
            port: asNumber(native.port, 80),
            authMethod: native.authMethod,
            token: native.token,
            username: native.username,
            password: native.password,
            requestTimeoutMs: asNumber(native.requestTimeoutMs, 5000),
            mqttPort: asNumber(native.mqttPort, 1883),
            mqttUsername: native.mqttUsername,
            mqttPassword: native.mqttPassword,
        });
        const result = response as ConnectionTabState['testResult'];
        this.setState({ testing: false, testResult: result });
    };

    /** @returns a checkmark/cross line for one half of the combined test result */
    private renderResultLine(
        label: string,
        result: { ok: boolean; error?: string } | undefined,
    ): React.JSX.Element | null {
        if (!result) {
            return null;
        }
        return (
            <div style={{ color: result.ok ? '#2e7d32' : '#c62828', fontSize: 13 }}>
                {result.ok ? '✓' : '✗'} {label}
                {!result.ok && result.error ? `: ${result.error}` : ''}
            </div>
        );
    }

    /** @returns the connection settings form */
    render(): React.JSX.Element {
        const native = this.props.native;
        const authMethod = asString(native.authMethod, 'none');

        return (
            <div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <TextField
                        label={I18n.t('Host / IP address')}
                        helperText={I18n.t('Hostname or IP address of the openWB device')}
                        style={{ minWidth: 320 }}
                        value={asString(native.host, '')}
                        onChange={e => this.props.onChange('host', e.target.value)}
                        margin="normal"
                    />
                    <TextField
                        select
                        label={I18n.t('Protocol')}
                        style={{ minWidth: 120 }}
                        value={asString(native.protocol, 'http')}
                        onChange={e => this.props.onChange('protocol', e.target.value)}
                        margin="normal"
                    >
                        <MenuItem value="http">http</MenuItem>
                        <MenuItem value="https">https</MenuItem>
                    </TextField>
                </div>

                <div style={{ marginTop: 8, marginBottom: 16 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={() => void this.testConnection()}
                        disabled={this.state.testing}
                    >
                        {I18n.t('Test connection')}
                    </Button>
                    {this.state.testResult && (
                        <div style={{ marginTop: 8 }}>
                            {this.renderResultLine(I18n.t('HTTP (writes)'), this.state.testResult.http)}
                            {this.renderResultLine(I18n.t('MQTT (reads)'), this.state.testResult.mqtt)}
                        </div>
                    )}
                </div>

                <Accordion>
                    <AccordionSummary expandIcon={<span>&#9660;</span>}>
                        <Typography>{I18n.t('Advanced')}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, color: '#9AA3AE', marginBottom: 4 }}>
                            {I18n.t(
                                "openWB has no user interface to set up simpleAPI or MQTT credentials - these only work if you have edited openWB's own config files by hand.",
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 14 }}>
                            <TextField
                                label={I18n.t('HTTP port')}
                                type="number"
                                style={{ minWidth: 140 }}
                                value={asNumber(native.port, 80)}
                                onChange={e => this.props.onChange('port', Number(e.target.value))}
                                margin="normal"
                            />
                            <TextField
                                label={I18n.t('MQTT port')}
                                type="number"
                                style={{ minWidth: 140 }}
                                value={asNumber(native.mqttPort, 1883)}
                                onChange={e => this.props.onChange('mqttPort', Number(e.target.value))}
                                margin="normal"
                            />
                            <TextField
                                label={I18n.t('Request timeout (ms)')}
                                type="number"
                                style={{ minWidth: 160 }}
                                value={asNumber(native.requestTimeoutMs, 5000)}
                                onChange={e => this.props.onChange('requestTimeoutMs', Number(e.target.value))}
                                margin="normal"
                            />
                        </div>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
                            <TextField
                                select
                                label={I18n.t('HTTP authentication')}
                                style={{ minWidth: 220 }}
                                value={authMethod}
                                onChange={e => this.props.onChange('authMethod', e.target.value)}
                                margin="normal"
                            >
                                <MenuItem value="none">{I18n.t('None')}</MenuItem>
                                <MenuItem value="bearer">{I18n.t('Bearer token')}</MenuItem>
                                <MenuItem value="userpass">{I18n.t('Username / password')}</MenuItem>
                            </TextField>
                            {authMethod === 'bearer' && (
                                <TextField
                                    label={I18n.t('Bearer token')}
                                    type="password"
                                    style={{ minWidth: 220 }}
                                    value={asString(native.token, '')}
                                    onChange={e => this.props.onChange('token', e.target.value)}
                                    margin="normal"
                                />
                            )}
                            {authMethod === 'userpass' && (
                                <>
                                    <TextField
                                        label={I18n.t('Username')}
                                        style={{ minWidth: 180 }}
                                        value={asString(native.username, '')}
                                        onChange={e => this.props.onChange('username', e.target.value)}
                                        margin="normal"
                                    />
                                    <TextField
                                        label={I18n.t('Password')}
                                        type="password"
                                        style={{ minWidth: 180 }}
                                        value={asString(native.password, '')}
                                        onChange={e => this.props.onChange('password', e.target.value)}
                                        margin="normal"
                                    />
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 14 }}>
                            <TextField
                                label={I18n.t('MQTT username')}
                                helperText={I18n.t('Leave empty if the broker allows anonymous access')}
                                style={{ minWidth: 220 }}
                                value={asString(native.mqttUsername, '')}
                                onChange={e => this.props.onChange('mqttUsername', e.target.value)}
                                margin="normal"
                            />
                            <TextField
                                label={I18n.t('MQTT password')}
                                type="password"
                                style={{ minWidth: 220 }}
                                value={asString(native.mqttPassword, '')}
                                onChange={e => this.props.onChange('mqttPassword', e.target.value)}
                                margin="normal"
                            />
                        </div>
                    </AccordionDetails>
                </Accordion>
            </div>
        );
    }
}
