import React from 'react';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';

import I18n from '@iobroker/adapter-react/i18n';
import type Connection from '@iobroker/adapter-react/Connection';

import { asString, asNumber } from '../nativeUtils';

export interface MqttTabProps {
    native: Record<string, unknown>;
    onChange: (attr: string, value: unknown) => void;
    socket: Connection;
    instanceId: string;
    onToast: (text: string) => void;
}

/**
 * MQTT broker connection (the read path - see README's "Why MQTT for reads" section) and the
 * background interval for picking up newly-observed component IDs.
 */
export default class MqttTab extends React.Component<MqttTabProps> {
    private checkNow = async (): Promise<void> => {
        await this.props.socket.sendTo(this.props.instanceId, 'rediscoverNow', {});
        this.props.onToast(
            I18n.t('Check triggered - check the log, the instance restarts if new components were found'),
        );
    };

    /** @returns the MQTT broker settings form */
    render(): React.JSX.Element {
        const native = this.props.native;

        return (
            <div>
                <div>
                    <TextField
                        label={I18n.t('MQTT broker host / IP address')}
                        helperText={I18n.t("Usually the same device as the Connection tab's host")}
                        style={{ minWidth: 300, marginRight: 16 }}
                        value={asString(native.mqttHost, '')}
                        onChange={e => this.props.onChange('mqttHost', e.target.value)}
                        margin="normal"
                    />
                    <TextField
                        label={I18n.t('Port')}
                        type="number"
                        style={{ minWidth: 100 }}
                        value={asNumber(native.mqttPort, 1883)}
                        onChange={e => this.props.onChange('mqttPort', Number(e.target.value))}
                        margin="normal"
                    />
                </div>
                <div>
                    <TextField
                        label={I18n.t('Username')}
                        helperText={I18n.t('Leave empty if the broker allows anonymous access')}
                        style={{ minWidth: 200, marginRight: 16 }}
                        value={asString(native.mqttUsername, '')}
                        onChange={e => this.props.onChange('mqttUsername', e.target.value)}
                        margin="normal"
                    />
                    <TextField
                        label={I18n.t('Password')}
                        type="password"
                        style={{ minWidth: 200 }}
                        value={asString(native.mqttPassword, '')}
                        onChange={e => this.props.onChange('mqttPassword', e.target.value)}
                        margin="normal"
                    />
                </div>
                <div>
                    <TextField
                        label={I18n.t('New-device check interval (minutes)')}
                        helperText={I18n.t(
                            'How often the adapter checks whether MQTT has revealed component IDs not yet in the Components table',
                        )}
                        type="number"
                        style={{ minWidth: 300 }}
                        value={asNumber(native.discoveryIntervalMin, 60)}
                        onChange={e => this.props.onChange('discoveryIntervalMin', Number(e.target.value))}
                        margin="normal"
                    />
                </div>
                <div style={{ marginTop: 16 }}>
                    <Button
                        variant="contained"
                        onClick={() => void this.checkNow()}
                    >
                        {I18n.t('Check now')}
                    </Button>
                </div>
            </div>
        );
    }
}
