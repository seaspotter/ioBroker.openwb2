/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import AppBar from '@mui/material/AppBar';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

import { GenericApp, I18n, type GenericAppProps, type GenericAppSettings } from '@iobroker/adapter-react-v5';

import ConnectionTab from './components/ConnectionTab';
import ComponentsTab from './components/ComponentsTab';

/** Admin settings UI: Connection/Components tabs over the instance's native config. */
class App extends GenericApp {
    // plain field + forceUpdate rather than React state: GenericApp's setState() type is fixed to
    // its own GenericAppState by the base class, so a locally-added state field can't flow through
    // it cleanly (same approach as iobroker.meterops' admin/src/app.tsx).
    private tab = 0;

    /** @param props - props ioBroker admin passes to every custom settings component */
    constructor(props: GenericAppProps) {
        const extendedProps: GenericAppSettings = {
            ...props,
            encryptedFields: ['token', 'password', 'mqttPassword'],
            translations: {
                en: require('./i18n/en.json'),
                de: require('./i18n/de.json'),
                ru: require('./i18n/ru.json'),
                pt: require('./i18n/pt.json'),
                nl: require('./i18n/nl.json'),
                fr: require('./i18n/fr.json'),
                it: require('./i18n/it.json'),
                es: require('./i18n/es.json'),
                pl: require('./i18n/pl.json'),
                uk: require('./i18n/uk.json'),
                'zh-cn': require('./i18n/zh-cn.json'),
            },
        };
        super(props, extendedProps);
    }

    /** Executed when the socket.io connection is ready - nothing to prefetch here. */
    onConnectionReady(): void {
        // executed when connection is ready
    }

    /** @returns the tabbed settings UI once loaded, or GenericApp's own loading placeholder before that */
    render(): React.JSX.Element {
        if (!this.state.loaded) {
            return super.render();
        }

        const onNativeChange = (attr: string, value: unknown): void => this.updateNativeValue(attr, value);

        return (
            <div className="App">
                <AppBar
                    position="static"
                    color="default"
                >
                    <Tabs
                        value={this.tab}
                        onChange={(_e, tab: number) => {
                            this.tab = tab;
                            this.forceUpdate();
                        }}
                        indicatorColor="primary"
                        textColor="primary"
                        variant="scrollable"
                    >
                        <Tab label={I18n.t('Connection')} />
                        <Tab label={I18n.t('Components')} />
                    </Tabs>
                </AppBar>

                <div style={{ padding: 16 }}>
                    {this.tab === 0 && (
                        <ConnectionTab
                            native={this.state.native}
                            onChange={onNativeChange}
                            socket={this.socket}
                            instanceId={this.instanceId}
                            onToast={text => this.showToast(text)}
                        />
                    )}
                    {this.tab === 1 && (
                        <ComponentsTab
                            native={this.state.native}
                            onChange={onNativeChange}
                            socket={this.socket}
                            instanceId={this.instanceId}
                            onToast={text => this.showToast(text)}
                            onError={text => this.showError(text)}
                        />
                    )}
                </div>

                {this.renderError()}
                {this.renderToast()}
                {this.renderSaveCloseButtons()}
            </div>
        );
    }
}

export default App;
