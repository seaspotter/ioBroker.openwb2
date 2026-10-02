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
targets, chargepoint lock, battery mode, ...) via its `simpleAPI` HTTP interface, from ioBroker.

> **Disclaimer:** this is an independent, community-maintained adapter. It is not affiliated with, endorsed
> by, or supported by openWB GmbH & Co. KG. "openWB" is a trademark of its respective owner; the adapter
> icon is openWB's own official logo, used with permission from openWB.

### Why MQTT for reads, HTTP for writes

Polling `simpleapi.php` over HTTP for every read would work, but `simpleapi.php` shells out to a fresh
`mosquitto_sub` process per request server-side (roughly 1-2.5s per request) and, worse, has no reliable way
to discover which component IDs actually exist - every read endpoint returns defaulted zeros for a
nonexistent ID exactly like it would for a real, idle device, so there's no signal to probe for. MQTT
doesn't have either problem: openWB already republishes normalized data
under `openWB/simpleAPI/#` (retained, so a fresh subscribe immediately yields the current state of
everything), and a topic for a nonexistent ID simply never arrives - discovery becomes free and reliable
instead of a periodic network call. Writes stay on HTTP regardless: `simpleapi.php`'s control writes
(chargemode, current limits, ...) do a read-modify-write of the whole `charge_template` JSON document
server-side, and there's no reason to reimplement that logic just to avoid one occasional HTTP POST.

Everything this adapter reads comes from `openWB/simpleAPI/#` specifically, never the raw underlying MQTT
namespace.

### Requirements

- openWB 2.3 or later - `simpleAPI` is always active on these versions, nothing to enable - with its
  MQTT broker reachable from your ioBroker host (the same device usually serves both the broker and
  the HTTP interface).

### Configuration

The admin UI has two tabs:

- **Connection** - one shared **Host / IP address** field drives both the HTTP side (writes, and the
  **Test connection** button) and the MQTT side (reads) - verified against real setups, it's always the
  same device. The path to `simpleapi.php` is fixed (`/openWB/simpleAPI/simpleapi.php`) and not
  configurable, since it never changes. **Test connection** checks both halves in one go and reports each
  separately. An **Advanced** section holds everything most installs never touch: HTTP/MQTT ports, request
  timeout, HTTP authentication (none / bearer token / username+password) and MQTT username/password - openWB
  has no user interface to set any of this up, so it only matters if you've edited openWB's own config files
  by hand.
- **Components** - the component discovery table. Press **Probe now** to see what the live MQTT connection
  has already observed; newly found chargepoints/counters/batteries/PV/consumers are added as new rows,
  **disabled by default** - ticking a row's checkbox (and Save) is what actually creates its objects and
  starts tracking it, discovery only ever proposes, never activates automatically. Give a row a **Name** if
  you want more than its raw ID in the object tree - openWB only reports a configured name over MQTT for
  chargepoints, so counters/batteries/PV need a manual name. Untick or remove a row you don't
  want active; a row no longer observed is flagged, not deleted, in case the device is just temporarily
  offline. You can also add an ID by hand. The **new-device check interval** repeats the same "add,
  disabled" discovery in the background (`0`, the default, turns it off) so a new device you plug in shows
  up in the table without a config-screen visit. Either way, the adapter instance restarts whenever the
  table actually changes (any native-config change restarts an ioBroker adapter instance) - newly
  added-but-disabled rows don't change what the running adapter does until you enable them. Below the
  table, pv/chargepoint system-wide totals (`pv.total.*`/`chargepoint.total.*`) appear automatically once
  at least one instance of that type is enabled - they're not a discoverable device of their own, so there's
  no separate row for them. **Energy values shown as** switches every cumulative energy counter
  (`imported`/`exported` and their `daily_`/`monthly_`/`yearly_` variants, across every component type, plus
  the totals and home-consumption channels) between `Wh` (the wire format, default) and `kWh` (divided by
  1000, rounded to 2 decimal places) - purely a display choice, nothing about the MQTT data itself changes.

### Object structure

```
openwb2.0.info.connection                  boolean, true while connected to the MQTT broker
openwb2.0.chargepoint.<id>.<field>          read-only: power, voltages/currents/powers per phase, soc,
                                             state_str, plug_state, charge_state, rfid, configName, ...
openwb2.0.chargepoint.<id>.control.<field>  writable: chargemode, chargepointLock, maxPriceEco,
                                             instantChargingCurrent/Limit/Amount/Soc,
                                             pvChargingLimit/Amount/Soc/MinCurrent/MinSoc, vehicle
openwb2.0.counter.<id>.<field>              read-only
openwb2.0.battery.<id>.<field>              read-only
openwb2.0.battery.<id>.control.batMode           writable enum: min_soc_bat_mode / ev_mode / bat_mode
openwb2.0.battery.<id>.control.batPowerReserve   writable number, W
openwb2.0.pv.<id>.<field>                   read-only
openwb2.0.consumer.<id>.<field>             read-only
openwb2.0.pv.total.<field>                  read-only: power, exported, monthlyExported, yearlyExported -
                                             system-wide sum across all enabled PV modules, appears once at
                                             least one pv.<id> is enabled (see Components tab below)
openwb2.0.chargepoint.total.<field>         read-only: power, imported, exported - system-wide sum across
                                             all enabled chargepoints, same appearance rule as pv.total
openwb2.0.homeConsumption.<field>           read-only: power, dailyConsumption, totalConsumption,
                                             excludedPower, disengageableSmarthomePower, invalidReadings -
                                             openWB's own estimated whole-house consumption (not a physical
                                             meter); always created, like info.connection - stays null if
                                             openWB isn't computing this
```

Read-only values and writable controls are split into separate channels (`chargepoint.<id>.*` vs.
`chargepoint.<id>.control.*`) so the writable surface is easy to enumerate and doesn't get mixed up with
mirrored read-only values that happen to represent the same underlying setting. `batMode`/`batPowerReserve`
live under each enabled battery instance's own `control` channel for the same layout consistency, even
though openWB treats them as one global setting rather than per-battery (writing via one battery's control
affects the same underlying setting a second battery's control would show).

All cumulative energy fields (`imported`, `exported`, and their `daily_`/`monthly_`/`yearly_` variants) are
in **Wh** by default, matching what's actually on the wire - not kWh. The Connection tab's **Energy values
shown as** setting switches this instance-wide to kWh instead, if you prefer (see "Configuration" above).

Most chargepoint control states also show the real, device-confirmed current value (not just an echo of
what you last wrote) - populated at startup and refreshed shortly after any change, whether it came from
this adapter or from openWB's own UI.

### Known limitations

- Component discovery only ever adds rows, and always disabled - it never activates or deletes anything on
  its own. Tick a row's checkbox yourself (and Save) once you've confirmed it's the device you expect.
- The MQTT broker connection currently has no TLS option in the admin UI - only plain `mqtt://`.

## Developer manual

This section is intended for the developer.

### Scripts in `package.json`

| Script name        | Description                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `build`            | Compile the TypeScript backend and the React admin UI.                                                                 |
| `watch`            | Same, but watching for changes.                                                                                        |
| `test:ts`          | Executes the unit tests in `src/**/*.test.ts`.                                                                         |
| `test:package`     | Ensures `package.json` and `io-package.json` are valid.                                                                |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker.                                                         |
| `test`             | Runs `test:ts` and `test:package`.                                                                                     |
| `check`            | Type-checks both the backend and the admin UI without compiling.                                                       |
| `lint`             | Runs ESLint.                                                                                                           |
| `translate`        | Translates admin UI texts, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations). |

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

- (SeaSpotter) Migrated the admin UI from `@iobroker/adapter-react-v5` to its official successor
  `@iobroker/gui-components`, and upgraded to React 19 and MUI 9.

### 0.2.1 (2026-10-02)

- (SeaSpotter) Clarified in the README that `simpleAPI` is always active since openWB 2.3 (nothing
  to enable), and removed remaining mentions of IO module support.
- (SeaSpotter) Added GitHub repository topics and a Dependabot configuration for automatic
  dependency updates.

### 0.2.0 (2026-10-02)

- (SeaSpotter) Replaced the adapter icon with openWB's own official logo, used with permission from
  openWB.
- (SeaSpotter) Added an **Energy values shown as** setting (Components tab): switches every
  cumulative energy counter instance-wide between `Wh` (wire format, default) and `kWh` (divided by
  1000, rounded to 2 decimal places) - a display choice only, the MQTT data itself is unaffected.
- (SeaSpotter) `pvChargingMinCurrent`, `chargeTemplateName` and `instantChargingCurrent` now update
  live over MQTT (`minimal_permanent_current`, and the `set/charge_template/...` sub-tree
  respectively - all confirmed live under `openWB/simpleAPI/chargepoint/<id>/...`, none of them
  mapped to these read-only fields before).
- (SeaSpotter) Added several previously-missing chargepoint read-only fields, all confirmed live
  against a real device's full `openWB/simpleAPI/chargepoint/<id>/#` topic list: `chargingCurrent`/
  `chargingPower`/`chargingVoltage` (the actual real-time delivered values), `maxChargePower`/
  `maxDischargePower` (bidirectional/V2G limits), and `socRange`/`socFaultStr`/`socFaultState` (the
  connected vehicle's remaining range, always km, and the SoC-reader module's own fault status, as
  opposed to `rangeCharged` and the chargepoint's own fault fields).
- (SeaSpotter) Added `pv.total.*`/`chargepoint.total.*` (system-wide sums across all enabled
  instances of that type, confirmed live under `openWB/simpleAPI/<type>/total/...`) and a new
  `homeConsumption.*` singleton channel for openWB's own estimated whole-house consumption
  (confirmed live under `openWB/simpleAPI/counter/set/...`, upstream source:
  `packages/control/counter_all/counter_all_data.py`). Totals appear automatically once at least
  one instance of that type is enabled; `homeConsumption.*` is always created, like `info.*` - it
  just stays `null` if openWB isn't computing this.
- (SeaSpotter) Added a handful more confirmed-live chargepoint read-only fields found via a full
  diff against a real device's complete topic list: `pvChargingMinSoc` (`minimal_pv_soc` - the
  missing counterpart to `pvChargingMinCurrent`), `proSocTimestamp` (companion to the existing
  `proSoc`), `serialNumber`, `firmwareVersion`, `connectedPhases`, and `chargepointType`.
- (SeaSpotter) Fixed `soc`/`socTimestamp` reading empty on a real device - the flat bare `soc`/
  `soc_timestamp` fields aren't populated; the data actually lives under the `soc.*` sub-object
  alias (`soc/soc`/`soc/timestamp`), confirmed live.
- (SeaSpotter) Every state and channel this adapter creates now has a name translated into all 11
  languages ioBroker supports, including the Components tab's own component-type labels - not just
  English.
- (SeaSpotter) **New-device check interval** now defaults to off (`0`) instead of every 24h - turn
  it on in the Components tab if you want periodic background discovery in addition to the manual
  **Probe now** button.
- (SeaSpotter) Marked `token`/`password`/`mqttPassword` as protected, not just encrypted, in the
  admin UI, matching ioBroker's recommended handling for credential fields.

### 0.1.0 (2026-09-22)

- (SeaSpotter) Reads now come from a live MQTT connection (`openWB/simpleAPI/#`) instead of HTTP
  polling - lower latency, and reliable component discovery. Writes are unchanged (still HTTP). See
  the README's "Why MQTT for reads, HTTP for writes" section.
- (SeaSpotter) Migrated the admin UI to `@iobroker/adapter-react-v5`/MUI 6 (the previous
  `@iobroker/adapter-react` was incompatible with current ioBroker Admin and showed a blank
  settings page) and merged the Connection/MQTT tabs into one, with a shared host field and a
  combined "Test connection" button.
- (SeaSpotter) Fixed a missing `"messagebox": true` in `io-package.json` that silently broke
  "Test connection" and "Probe now".
- (SeaSpotter) Fixed the connection test's HTTP check timing out against real devices (was probing
  a chargepoint ID that may not exist; now uses `get_lastlivevaluesjson`).
- (SeaSpotter) Fixed all cumulative energy fields being mislabeled as kWh - they're Wh on the wire.
- (SeaSpotter) Most chargepoint control states now show their real, device-confirmed value instead
  of staying `null` until written. `batMode`/`batPowerReserve` live under each battery instance's
  own control channel.
- (SeaSpotter) Newly discovered components are added disabled, not enabled, so probing never
  silently activates a device you haven't reviewed. Added a per-row Name column for components
  other than chargepoints (openWB doesn't report a name for those over MQTT).
- (SeaSpotter) Added PV charging limit control: `pvChargingLimit`/`pvChargingAmount`/`pvChargingSoc`
  under each chargepoint's control channel, mirroring the existing instant-charging limit fields
  (limit type none/amount/soc, amount in kWh, SoC in %), with the same live device-confirmed value.

### 0.0.1 (2026-09-21)

- (SeaSpotter) initial release

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
