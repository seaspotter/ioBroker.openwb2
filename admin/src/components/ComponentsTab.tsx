import React from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';

import { I18n, type AdminConnection } from '@iobroker/adapter-react-v5';

import { COMPONENT_TYPES, type ComponentIds, type ComponentType } from '../../../src/lib/constants';
import {
    parseComponentTable,
    serializeComponentTable,
    mergeDiscovered,
    type ComponentTableRow,
} from '../../../src/lib/componentTable';
import { asNumber } from '../nativeUtils';

export interface ComponentsTabProps {
    native: Record<string, unknown>;
    onChange: (attr: string, value: unknown) => void;
    socket: AdminConnection;
    instanceId: string;
    onToast: (text: string) => void;
    onError: (text: string) => void;
}

interface ComponentsTabState {
    /** result of the most recent successful "Probe now" run, for the "not currently reported" hint */
    lastProbe?: ComponentIds;
    probing: boolean;
    addType: ComponentType;
    addId: string;
}

/**
 * The component discovery table: press "Probe now" to see what the adapter's live MQTT
 * connection has already observed (merged in as new enabled rows, existing rows/edits are never
 * touched), untick/remove rows you don't want active, or add an ID by hand (e.g. for a component
 * that hasn't published anything yet). native.componentTable (see src/lib/componentTable.ts) is
 * the single persisted source of truth - this component only ever reads/writes it via
 * props.native/onChange, exactly like the admin's own Save button.
 */
export default class ComponentsTab extends React.Component<ComponentsTabProps, ComponentsTabState> {
    public constructor(props: ComponentsTabProps) {
        super(props);
        this.state = { probing: false, addType: 'chargepoint', addId: '' };
    }

    private get rows(): ComponentTableRow[] {
        return parseComponentTable(this.props.native.componentTable as string | undefined);
    }

    private setRows(rows: ComponentTableRow[]): void {
        this.props.onChange('componentTable', serializeComponentTable(rows));
    }

    private probeNow = async (): Promise<void> => {
        this.setState({ probing: true });
        const response = await this.props.socket.sendTo(this.props.instanceId, 'probeComponents', {});
        const result = response as { ok: boolean; data?: ComponentIds; error?: string } | undefined;
        this.setState({ probing: false });

        if (!result || !result.ok || !result.data) {
            this.props.onError(result?.error ?? I18n.t('Probe failed'));
            return;
        }

        this.setState({ lastProbe: result.data });
        const { rows, added } = mergeDiscovered(this.rows, result.data);
        if (added.length > 0) {
            this.setRows(rows);
            this.props.onToast(I18n.t('Found %s new component(s)', String(added.length)));
        } else {
            this.props.onToast(I18n.t('No new components found'));
        }
    };

    private toggleRow(index: number): void {
        const rows = [...this.rows];
        rows[index] = { ...rows[index], enabled: !rows[index].enabled };
        this.setRows(rows);
    }

    private renameRow(index: number, name: string): void {
        const rows = [...this.rows];
        rows[index] = { ...rows[index], name: name.trim() === '' ? undefined : name };
        this.setRows(rows);
    }

    private deleteRow(index: number): void {
        const rows = [...this.rows];
        rows.splice(index, 1);
        this.setRows(rows);
    }

    private addRow = (): void => {
        const id = Number(this.state.addId);
        if (!Number.isFinite(id) || id < 0) {
            return;
        }
        const type = this.state.addType;
        if (this.rows.some(row => row.type === type && row.id === id)) {
            return;
        }
        this.setRows([...this.rows, { type, id, enabled: true }]);
        this.setState({ addId: '' });
    };

    private checkNow = async (): Promise<void> => {
        await this.props.socket.sendTo(this.props.instanceId, 'rediscoverNow', {});
        this.props.onToast(
            I18n.t('Check triggered - check the log, the instance restarts if new components were found'),
        );
    };

    /**
     * @param row - table row to check against the last probe's result
     * @returns true/false if a probe has run this session and did/didn't report this row, undefined if no probe has run yet
     */
    private isReported(row: ComponentTableRow): boolean | undefined {
        if (!this.state.lastProbe) {
            return undefined;
        }
        return this.state.lastProbe[row.type].includes(row.id);
    }

    /** @returns the discovery table, probe button, and manual add-row form */
    render(): React.JSX.Element {
        const rows = this.rows;

        return (
            <div>
                <div style={{ marginBottom: 16 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={() => void this.probeNow()}
                        disabled={this.state.probing}
                    >
                        {I18n.t('Probe now')}
                    </Button>
                    <span style={{ marginLeft: 16, opacity: 0.7 }}>
                        {I18n.t(
                            'Shows what the live MQTT connection has already seen. Consumer support needs openWB/core PR #3981 or later; everything else works on any core. If nothing shows up yet, add an ID manually below.',
                        )}
                    </span>
                </div>
                <div style={{ marginBottom: 16, opacity: 0.7, fontSize: 13 }}>
                    {I18n.t(
                        'openWB only reports a configured device name over MQTT for chargepoints - name counters, batteries, PV inverters and IO modules manually below if you want more than the ID shown in the object tree.',
                    )}
                </div>

                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>{I18n.t('Enabled')}</TableCell>
                            <TableCell>{I18n.t('Type')}</TableCell>
                            <TableCell>{I18n.t('ID')}</TableCell>
                            <TableCell>{I18n.t('Name')}</TableCell>
                            <TableCell>{I18n.t('Status')}</TableCell>
                            <TableCell />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((row, index) => {
                            const reported = this.isReported(row);
                            return (
                                <TableRow key={`${row.type}-${row.id}`}>
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            checked={row.enabled}
                                            onChange={() => this.toggleRow(index)}
                                        />
                                    </TableCell>
                                    <TableCell>{row.type}</TableCell>
                                    <TableCell>{row.id}</TableCell>
                                    <TableCell>
                                        <TextField
                                            size="small"
                                            variant="standard"
                                            placeholder={`${row.type} ${row.id}`}
                                            value={row.name ?? ''}
                                            onChange={e => this.renameRow(index, e.target.value)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {reported === false
                                            ? I18n.t('not currently reported')
                                            : reported === true
                                              ? I18n.t('reported')
                                              : ''}
                                    </TableCell>
                                    <TableCell>
                                        <IconButton
                                            size="small"
                                            title={I18n.t('Remove')}
                                            onClick={() => this.deleteRow(index)}
                                        >
                                            &#10005;
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6}>
                                    {I18n.t('No components configured yet - probe or add one below.')}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>

                <div style={{ marginTop: 16 }}>
                    <TextField
                        select
                        label={I18n.t('Type')}
                        style={{ minWidth: 160, marginRight: 16 }}
                        value={this.state.addType}
                        onChange={e => this.setState({ addType: e.target.value as ComponentType })}
                    >
                        {COMPONENT_TYPES.map(type => (
                            <MenuItem
                                key={type}
                                value={type}
                            >
                                {type}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        label={I18n.t('ID')}
                        type="number"
                        style={{ minWidth: 100, marginRight: 16 }}
                        value={this.state.addId}
                        onChange={e => this.setState({ addId: e.target.value })}
                    />
                    <Button
                        variant="outlined"
                        onClick={this.addRow}
                    >
                        {I18n.t('Add')}
                    </Button>
                </div>

                <div style={{ marginTop: 32, borderTop: '1px solid #E2E5EA', paddingTop: 16 }}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
                        <TextField
                            label={I18n.t('New-device check interval (minutes)')}
                            helperText={I18n.t(
                                'How often the adapter checks whether MQTT has revealed component IDs not yet in this table - 0 disables the automatic check',
                            )}
                            type="number"
                            style={{ minWidth: 300 }}
                            value={asNumber(this.props.native.discoveryIntervalMin, 1440)}
                            onChange={e => this.props.onChange('discoveryIntervalMin', Number(e.target.value))}
                            margin="normal"
                        />
                        <Button
                            variant="outlined"
                            onClick={() => void this.checkNow()}
                        >
                            {I18n.t('Check now')}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}
