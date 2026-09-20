import React from 'react';
import TextField from '@material-ui/core/TextField';
import MenuItem from '@material-ui/core/MenuItem';
import Button from '@material-ui/core/Button';

import I18n from '@iobroker/adapter-react/i18n';
import type Connection from '@iobroker/adapter-react/Connection';

import { asString, asNumber } from '../nativeUtils';

export interface ConnectionTabProps {
    native: Record<string, unknown>;
    onChange: (attr: string, value: unknown) => void;
    socket: Connection;
    instanceId: string;
    onToast: (text: string) => void;
}

/** simpleAPI connection settings (host/port/auth) plus a "Test connection" sendTo button. */
export default class ConnectionTab extends React.Component<ConnectionTabProps> {
    private testConnection = async (): Promise<void> => {
        const { native, socket, instanceId, onToast } = this.props;
        const response = await socket.sendTo(instanceId, 'testConnection', {
            protocol: native.protocol,
            host: native.host,
            port: asNumber(native.port, 0),
            basePath: native.basePath,
            authMethod: native.authMethod,
            token: native.token,
            username: native.username,
            password: native.password,
            requestTimeoutMs: asNumber(native.requestTimeoutMs, 5000),
        });
        const result = response as { result?: string; error?: string } | undefined;
        onToast(result?.error ? I18n.t('Connection failed: %s', result.error) : I18n.t('Connection successful'));
    };

    /** @returns the connection settings form */
    render(): React.JSX.Element {
        const native = this.props.native;
        const authMethod = asString(native.authMethod, 'none');

        return (
            <div>
                <div>
                    <TextField
                        select
                        label={I18n.t('Protocol')}
                        style={{ minWidth: 120, marginRight: 16 }}
                        value={asString(native.protocol, 'http')}
                        onChange={e => this.props.onChange('protocol', e.target.value)}
                        margin="normal"
                    >
                        <MenuItem value="http">http</MenuItem>
                        <MenuItem value="https">https</MenuItem>
                    </TextField>
                    <TextField
                        label={I18n.t('Host / IP address')}
                        helperText={I18n.t('Hostname or IP address of the openWB device, without protocol')}
                        style={{ minWidth: 260, marginRight: 16 }}
                        value={asString(native.host, '')}
                        onChange={e => this.props.onChange('host', e.target.value)}
                        margin="normal"
                    />
                    <TextField
                        label={I18n.t('Port')}
                        type="number"
                        style={{ minWidth: 100 }}
                        value={asNumber(native.port, 80)}
                        onChange={e => this.props.onChange('port', Number(e.target.value))}
                        margin="normal"
                    />
                </div>
                <div>
                    <TextField
                        label={I18n.t('simpleAPI path')}
                        helperText={I18n.t('Path to simpleapi.php on the openWB webserver')}
                        style={{ minWidth: 400, marginRight: 16 }}
                        value={asString(native.basePath, '/openWB/simpleAPI/simpleapi.php')}
                        onChange={e => this.props.onChange('basePath', e.target.value)}
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
                <div>
                    <TextField
                        select
                        label={I18n.t('Authentication')}
                        style={{ minWidth: 220, marginRight: 16 }}
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
                            style={{ minWidth: 260 }}
                            value={asString(native.token, '')}
                            onChange={e => this.props.onChange('token', e.target.value)}
                            margin="normal"
                        />
                    )}
                    {authMethod === 'userpass' && (
                        <>
                            <TextField
                                label={I18n.t('Username')}
                                style={{ minWidth: 200, marginRight: 16 }}
                                value={asString(native.username, '')}
                                onChange={e => this.props.onChange('username', e.target.value)}
                                margin="normal"
                            />
                            <TextField
                                label={I18n.t('Password')}
                                type="password"
                                style={{ minWidth: 200 }}
                                value={asString(native.password, '')}
                                onChange={e => this.props.onChange('password', e.target.value)}
                                margin="normal"
                            />
                        </>
                    )}
                </div>
                <div style={{ marginTop: 16 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={() => void this.testConnection()}
                    >
                        {I18n.t('Test connection')}
                    </Button>
                </div>
            </div>
        );
    }
}
