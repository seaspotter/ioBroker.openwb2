import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { Theme, Utils } from '@iobroker/adapter-react-v5';
import App from './app';

let themeName = Utils.getThemeName();

const root = createRoot(document.getElementById('root')!);

function build(): void {
    root.render(
        <ThemeProvider theme={Theme(themeName)}>
            <App
                adapterName="openwb2"
                onThemeChange={_theme => {
                    themeName = _theme;
                    build();
                }}
            />
        </ThemeProvider>,
    );
}

build();
