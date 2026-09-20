# ioBroker.openwb2 — Kickoff Notes

Starting point for a new chat/session. Everything below was actually gathered and verified
(mostly via live testing against a real openWB system, `openwb-2` at `10.1.5.149`) in a prior,
unrelated engagement about openWB/core's `simpleAPI` — not guessed or assumed, except where
explicitly marked "unverified."

## Goal

Build an ioBroker adapter for openWB (a Raspberry-Pi-based EV charge controller), exposing its
chargepoints/counters/battery/PV/consumers as ioBroker states/objects.

## Architecture decision: talk to MQTT directly, not simpleAPI's HTTP interface

openWB already ships an HTTP interface (`simpleAPI/simpleapi.php`) that looks tempting to poll,
but don't use it as the adapter's primary data path. Reasoning, backed by a real timing test:

- Every HTTP request to `simpleapi.php` shells out to spawn a fresh `mosquitto_sub` subprocess
  per call (no persistent connection, no caching). Measured on real hardware: **~2-2.5 seconds
  per "all data" request**, dominated by subprocess-spawn + broker-handshake overhead, not by
  payload size. A `list_components` discovery call took **8.3 seconds** (6 sequential per-type
  scans).
- This scales badly: N devices polled independently means N × ~2s of real latency per sweep. A
  published, real-world example of this exact anti-pattern already exists: the community Home
  Assistant integration `a529987659852/openwb2mqtt` (despite its name) defaults to polling this
  same HTTP interface every 15s, via one independent `DataUpdateCoordinator` **per device** —
  its "MQTT mode" config option exists in the UI but its actual handler in `__init__.py` is a
  no-op stub. Don't copy that pattern.
- openWB's own MQTT broker already carries every value as a normal retained MQTT topic, updated
  by its Python control loop on its own cadence (a few seconds, driven by `control_interval`).
  Subscribing directly gives instant push updates with a persistent connection and **zero
  per-poll cost** — strictly better on every axis than HTTP polling, and it's the same data
  source `simpleapi.php` itself reads from under the hood.

**If ioBroker's own architecture makes a poll-based adapter unavoidable** (check ioBroker
adapter conventions for this — some adapter shapes are poll-driven by design), a fixed 15-20s
interval with parallel (not sequential) per-device requests would be the fallback, matching what
the HA integration does today at a scale that happens to work. But native MQTT via ioBroker's
own MQTT client capability (or the `mqtt` npm package directly) is the right default target.

## MQTT connection details — verify these against your actual install, don't assume

- Confirmed via testing (this session): on the openWB Pi itself, `simpleAPI`'s own internal
  connections use **port 1884** for the main broker, and various internal Python modules
  (e.g. `BrokerClient` in `helpermodules/broker.py`) use **port 1886** for a separate,
  no-auth "internal" broker meant only for same-host processes.
- **Not verified this session:** what port/credentials a genuinely external client (a real
  ioBroker instance on a different machine) should use to connect remotely. 1883 is the
  MQTT standard port and is plausibly what's exposed externally with authentication, but this
  needs to be confirmed against a real install's actual `mosquitto` listener config
  (`/etc/mosquitto/conf.d/` on the Pi) and firewall rules before assuming — don't guess.
- openWB uses MQTT username/password auth normally (see `simpleAPI_mqtt_config.json` shape,
  which has `host`/`port`/`username`/`password`/`use_tls`/`validate_cert` fields — the adapter's
  own config screen will need the same shape).

## Topic structure — real, tested examples

Raw topics follow `openWB/<type>/<id>/get/<field>`, e.g.:

```
openWB/consumer/5/get/power          → 34.5
openWB/consumer/5/get/currents       → [0.79, 0.71, 0.7]     (JSON array, 3 phases)
openWB/consumer/5/get/state_str      → "Messwerte des Verbrauchers werden erfasst."
openWB/consumer/5/get/fault_str      → "Kein Fehler."
openWB/consumer/5/config             → {"connected_phases": 3, "max_power": 5000, ...}
openWB/consumer/5/usage              → {"type": "meter_only", ...}
openWB/chargepoint/0/get/power       → 0
openWB/counter/0/get/imported        → 1125.5747037057383
```

Types seen: `chargepoint`, `counter`, `bat` (battery), `pv`, `consumer`, `io`.

**Important gotcha, confirmed via real payload inspection:** openWB's Python side (`Pub().pub()`)
JSON-encodes *every* published value, including plain strings. So a string-typed topic's raw
wire payload is literally `"Kein Fehler."` — with the quote characters as part of the payload,
not `Kein Fehler.` bare. **`JSON.parse()` every payload**, not just ones that look like objects/
arrays — a naive "starts with `{` or `[`" check (which is what openWB's own `simpleAPI_mqtt.py`
originally did, and which we had to fix) misses quoted-string payloads and leaves literal quote
characters in the value.

## Discovery (finding out which IDs exist)

Raw MQTT has no built-in "list all configured components" topic. Options, not yet evaluated in
depth for this project:
- Wildcard-subscribe a per-type topic (e.g. `openWB/consumer/+/get/power`) and collect whatever
  IDs respond — this is what `simpleAPI`'s own `MqttClient::findAllAvailableIds()` does
  internally (PHP side), scanning one wildcard pattern per type.
- Or read from whatever hierarchy/config topic openWB publishes describing its own component
  tree (not investigated this session — worth checking `packages/helpermodules/hierarchy.py`
  in `core` if going this route).

## Consumer support status (only matters if using simpleAPI HTTP as a fallback, not for raw MQTT)

Raw `openWB/consumer/#` topics already exist and are usable directly via MQTT regardless of
anything below — this only matters if you end up also wanting `simpleapi.php`'s HTTP interface
as a fallback/secondary path.

PR openWB/core#3981 (not yet merged as of this writing) added: consumer support to
`simpleapi.php`'s HTTP interface, a new `list_components` HTTP discovery endpoint, consumer
support to the MQTT-side republishing daemon (`simpleAPI/simpleAPI_mqtt.py`, republishes under
`openWB/simpleAPI/...`), and fixed the same string-quoting bug described above in two places
(the PHP HTTP layer and that daemon).

## Repo/dev setup — not started yet

This folder is currently empty except this file. Next steps for whoever picks this up:
- Scaffold via the official ioBroker adapter creator (`@iobroker/create-adapter`).
- Decide: use ioBroker's built-in MQTT-client adapter as a data source (if that's a supported
  pattern for adapter-to-adapter dependency), or have this adapter hold its own MQTT connection
  directly (likely simpler, more control, matches "instant push" goal above).
- Get real broker host/port/credentials from an actual openWB install before writing connection
  code — the port question above is the first thing to nail down.
