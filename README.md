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
controller live over MQTT, and lets you control charging (chargemode, current limits, instant-charging
targets, chargepoint lock, battery mode, IO outputs, ...) via its `simpleAPI` HTTP interface, from ioBroker.

> **Disclaimer:** this is an independent, community-maintained adapter. It is not affiliated with, endorsed
> by, or supported by openWB GmbH & Co. KG. "openWB" is a trademark of its respective owner; the adapter
> icon is an original design (a plug with a flowing cable, a generic EV-charging motif) and not a
> reproduction of, or derived from, openWB's own logo.

### Why MQTT for reads, HTTP for writes

An early version of this adapter polled `simpleapi.php` over HTTP for everything. That works, but
`simpleapi.php` shells out to a fresh `mosquitto_sub` process per request server-side (roughly 1-2.5s per
request) and, worse, has no reliable way to discover which component IDs actually exist - every read
endpoint returns defaulted zeros for a nonexistent ID exactly like it would for a real, idle device, so
there's no signal to probe for. MQTT doesn't have either problem: openWB already republishes normalized data
under `openWB/simpleAPI/#` (retained, so a fresh subscribe immediately yields the current state of
everything), and a topic for a nonexistent ID simply never arrives - discovery becomes free and reliable
instead of a periodic network call. Writes stay on HTTP regardless: `simpleapi.php`'s control writes
(chargemode, current limits, ...) do a read-modify-write of the whole `charge_template` JSON document
server-side, and there's no reason to reimplement that logic just to avoid one occasional HTTP POST.

IO is the one exception - `openWB/simpleAPI/#` doesn't mirror it at all, so IO reads subscribe to the raw
`openWB/io/states/+/get/#` namespace directly instead.

### Requirements

- openWB 2.x with `simpleAPI` enabled and its MQTT broker reachable from your ioBroker host (the same
  device usually serves both the broker and the HTTP interface).
- Consumer support specifically needs [PR #3981](https://github.com/openWB/core/pull/3981) or later merged
  upstream - chargepoint/counter/battery/PV work on any current core.

### Configuration

The admin UI has three tabs:

- **Connection** - the HTTP side, used only for writes and the **Test connection** button:
  protocol/host/port, the path to `simpleapi.php` (defaults to `/openWB/simpleAPI/simpleapi.php`),
  authentication (none / bearer token / username+password), request timeout.
- **MQTT** - the broker connection that drives all reads: host/port/username/password, the interval for
  automatically checking for newly-observed component IDs, and a **Check now** button.
- **Components** - the component discovery table. Press **Probe now** to see what the live MQTT connection
  has already observed; newly found chargepoints/counters/batteries/PV/consumers/IO modules are added as
  new, enabled rows without touching any row you've already edited. Untick or remove a row you don't want
  active. A row no longer observed is flagged, not deleted, in case the device is just temporarily offline.
  You can also add an ID by hand. The background check (MQTT tab) uses the same "add, never remove" logic
  automatically, so a new device you plug in gets picked up without a config-screen visit; the adapter
  instance restarts when it does (any native-config change restarts an ioBroker adapter instance).

### Object structure

```
openwb2.0.info.connection                  boolean, true while connected to the MQTT broker
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

- Component discovery only ever adds rows; nothing is ever deleted automatically. Remove stale entries
  yourself in the Components tab.
- IO output *names* are read from the device (they're user-defined in openWB's own io module config), so
  `io.<id>.digital.*`/`io.<id>.analog.*` objects only appear after the adapter has received at least one
  message for that IO module.
- A handful of read-only chargepoint fields (`configName`, `chargeTemplateName`, `minCurrent`,
  `instantChargingCurrent`, `pvChargingMinCurrent`) have no confirmed MQTT equivalent yet and simply won't
  update - they're minor settings mirrors, not anything the write path depends on.
- The MQTT broker connection currently has no TLS option in the admin UI - only plain `mqtt://`.

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
* (SeaSpotter) Reads now come from a live MQTT connection (`openWB/simpleAPI/#` plus the raw IO
  namespace) instead of HTTP polling - lower latency, and reliable component discovery. Writes
  are unchanged (still HTTP). See the README's "Why MQTT for reads, HTTP for writes" section.

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
