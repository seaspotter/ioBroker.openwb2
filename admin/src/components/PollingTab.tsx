import React from 'react';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';

import I18n from '@iobroker/adapter-react/i18n';
import type Connection from '@iobroker/adapter-react/Connection';

import { asNumber } from '../nativeUtils';

export interface PollingTabProps {
    native: Record<string, unknown>;
    onChange: (attr: string, value: unknown) => void;
    socket: Connection;
    instanceId: string;
    onToast: (text: string) => void;
}

/** Poll interval/concurrency and the background rediscovery interval, plus a manual trigger for it. */
export default class PollingTab extends React.Component<PollingTabProps> {
    private rediscoverNow = async (): Promise<void> => {
        await this.props.socket.sendTo(this.props.instanceId, 'rediscoverNow', {});
        this.props.onToast(
            I18n.t('Rediscovery triggered - check the log, the instance restarts if new components were found'),
        );
    };

    /** @returns the polling settings form */
    render(): React.JSX.Element {
        const native = this.props.native;

        return (
            <div>
                <div>
                    <TextField
                        label={I18n.t('Poll interval (seconds)')}
                        helperText={I18n.t('How often chargepoint/counter/battery/pv/consumer values are re-read')}
                        type="number"
                        style={{ minWidth: 260, marginRight: 16 }}
                        value={asNumber(native.pollIntervalS, 15)}
                        onChange={e => this.props.onChange('pollIntervalS', Number(e.target.value))}
                        margin="normal"
                    />
                    <TextField
                        label={I18n.t('Max parallel requests')}
                        helperText={I18n.t('Caps how many simpleapi.php requests run at once per poll cycle')}
                        type="number"
                        style={{ minWidth: 260 }}
                        value={asNumber(native.pollConcurrency, 4)}
                        onChange={e => this.props.onChange('pollConcurrency', Number(e.target.value))}
                        margin="normal"
                    />
                </div>
                <div>
                    <TextField
                        label={I18n.t('Rediscovery interval (minutes)')}
                        helperText={I18n.t(
                            'How often the adapter automatically probes for new devices in the background',
                        )}
                        type="number"
                        style={{ minWidth: 260 }}
                        value={asNumber(native.discoveryIntervalMin, 60)}
                        onChange={e => this.props.onChange('discoveryIntervalMin', Number(e.target.value))}
                        margin="normal"
                    />
                </div>
                <div style={{ marginTop: 16 }}>
                    <Button
                        variant="contained"
                        onClick={() => void this.rediscoverNow()}
                    >
                        {I18n.t('Rediscover now')}
                    </Button>
                </div>
            </div>
        );
    }
}
