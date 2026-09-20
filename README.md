![Logo](admin/openwb2.png)
# ioBroker.openwb2

[![NPM version](https://img.shields.io/npm/v/iobroker.openwb2.svg)](https://www.npmjs.com/package/iobroker.openwb2)
[![Downloads](https://img.shields.io/npm/dm/iobroker.openwb2.svg)](https://www.npmjs.com/package/iobroker.openwb2)
![Number of Installations](https://iobroker.live/badges/openwb2-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/openwb2-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.openwb2.png?downloads=true)](https://nodei.co/npm/iobroker.openwb2/)

**Tests:** ![Test and Release](https://github.com/seaspotter/ioBroker.openwb2/workflows/Test%20and%20Release/badge.svg)

## openwb2 adapter for ioBroker

Reads chargepoints, counters, battery, PV and consumers from an [openWB](https://openwb.de) 2 wallbox
controller via its `simpleAPI` HTTP interface, and lets you control charging (chargemode, current limits,
instant-charging targets, chargepoint lock, battery mode, IO outputs, ...) from ioBroker.

> **Disclaimer:** this is an independent, community-maintained adapter. It is not affiliated with, endorsed
> by, or supported by openWB GmbH & Co. KG. "openWB" is a trademark of its respective owner; the adapter
> icon is an original design (a plug with a flowing cable, a generic EV-charging motif) and not a
> reproduction of, or derived from, openWB's own logo.

### Why HTTP, not MQTT

openWB's own MQTT broker carries the same data with lower latency, and an earlier design note for this
adapter recommended using it directly. This adapter deliberately uses `simpleAPI`'s HTTP interface instead,
for simplicity - at the cost of `simpleapi.php` spawning a fresh `mosquitto_sub` process per request
server-side (roughly 1-2.5s per request, not per adapter poll cycle - see below). If HTTP polling turns out
to be too slow for your setup, the read path lives behind a narrow interface
([`simpleApiClient.ts`](src/lib/simpleApiClient.ts)) that could be swapped for a direct MQTT connection later
without touching object creation or the write path.

To keep this workable, the adapter batches requests: `simpleapi.php` can't return two instances of the
*same* component type in one HTTP call (it only keeps the last value for a repeated query parameter), but it
can combine *different* types in one call. Each poll cycle therefore issues `max(count per type)` requests,
not one request per device - see [`pollPlanner.ts`](src/lib/pollPlanner.ts).

### Requirements

- openWB 2.x with `simpleAPI` enabled and reachable over HTTP from your ioBroker host.
- For automatic component discovery (the "Probe now" button), your openWB core needs
  [PR #3981](https://github.com/openWB/core/pull/3981) or later merged - it's what adds the
  `list_components` endpoint. Without it, discovery is unavailable and components must be added by hand in
  the **Components** tab; the adapter detects this automatically and won't error, it'll just tell you to add
  IDs manually.

### Configuration

The admin UI has three tabs:

- **Connection** - protocol/host/port, the path to `simpleapi.php` (defaults to
  `/openWB/simpleAPI/simpleapi.php`), authentication (none / bearer token / username+password), request
  timeout, and a **Test connection** button.
- **Polling** - poll interval, how many requests may run in parallel per poll cycle, the background
  rediscovery interval, and a **Rediscover now** button.
- **Components** - the component discovery table. Press **Probe now** to query the device live; newly found
  chargepoints/counters/batteries/PV/consumers/IO modules are added as new, enabled rows without touching any
  row you've already edited. Untick or remove a row you don't want polled. A row a fresh probe no longer
  reports is flagged, not deleted, in case the device is just temporarily offline. You can also add an ID by
  hand (needed if `list_components` isn't available) - type, ID, **Add**. The background rediscovery timer
  (Polling tab) uses the same "add, never remove" logic automatically, so a new device you plug in gets
  picked up without a config-screen visit; the adapter instance restarts when it does (any native-config
  change restarts an ioBroker adapter instance).

### Object structure

```
openwb2.0.info.connection                  boolean, true if the last poll cycle reached the device at all
openwb2.0.chargepoint.<id>.<field>          read-only: power, voltages/currents/powers per phase, soc,
                                             state_str, plug_state, charge_state, rfid, ...
openwb2.0.chargepoint.<id>.control.<field>  writable: chargemode, chargecurrent, chargepointLock,
                                             minimalPvSoc, minimalPermanentCurrent, maxPriceEco,
                                             instantChargingLimit/Amount/Soc, vehicle, manualSoc
openwb2.0.counter.<id>.<field>              read-only
openwb2.0.battery.<id>.<field>              read-only
openwb2.0.pv.<id>.<field>                   read-only
openwb2.0.consumer.<id>.<field>             read-only (needs PR #3981 upstream)
openwb2.0.io.<id>.digital.<name>            writable boolean, <name> comes from your io module config
openwb2.0.io.<id>.analog.<name>             writable number, <name> comes from your io module config
openwb2.0.general.control.batMode           writable enum: min_soc_bat_mode / ev_mode / bat_mode
openwb2.0.general.control.batPowerReserve   writable number, W
```

Read-only values and writable controls are split into separate channels (`chargepoint.<id>.*` vs.
`chargepoint.<id>.control.*`) so the writable surface is easy to enumerate and doesn't get mixed up with
mirrored read-only values that happen to represent the same underlying setting.

### Known limitations

- No MQTT fallback yet (see "Why HTTP, not MQTT" above) - if your device has many components, polling all of
  them can take a few seconds per cycle; tune the poll interval and parallel-request count on the Polling
  tab.
- Component discovery only ever adds rows; nothing is ever deleted automatically. Remove stale entries
  yourself in the Components tab.
- IO output *names* are read from the device (they're user-defined in openWB's own io module config), so
  `io.<id>.digital.*`/`io.<id>.analog.*` objects only appear after the adapter has successfully polled that
  IO module at least once.

## Developer manual
This section is intended for the developer.

### Scripts in `package.json`
| Script name | Description |
|-------------|-------------|
| `build` | Compile the TypeScript backend and the React admin UI. |
| `watch` | Same, but watching for changes. |
| `test:ts` | Executes the unit tests in `src/**/*.test.ts`. |
| `test:package` | Ensures `package.json` and `io-package.json` are valid. |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker. |
| `test` | Runs `test:ts` and `test:package`. |
| `check` | Type-checks both the backend and the admin UI without compiling. |
| `lint` | Runs ESLint. |
| `translate` | Translates admin UI texts, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations). |

### Test the adapter manually with dev-server
```bash
dev-server watch
```
The ioBroker.admin interface will then be available at http://localhost:8083/. See the
[`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

### Publishing the adapter
Using GitHub Actions, automatic releases on npm can be enabled whenever a git tag matching
`v<major>.<minor>.<patch>` is pushed - see `.github/workflows/test-and-release.yml`. To get the adapter
released into the ioBroker repository, see
[ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (SeaSpotter) nothing yet

### 0.0.1 (2026-09-21)
* (SeaSpotter) initial release

## License
MIT License

Copyright (c) 2026 SeaSpotter <seatowage@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
