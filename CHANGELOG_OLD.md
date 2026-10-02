# Older changes

This holds changelog entries older than what's kept in the main [README.md](README.md). See there for
the current changelog.

## Changelog

### 0.2.1 (2026-10-02)

- (SeaSpotter) Clarified that `simpleAPI` is always active since openWB 2.3, and removed outdated
  IO-module mentions.
- (SeaSpotter) Added GitHub repository topics and a Dependabot configuration.

### 0.2.0 (2026-10-02)

- (SeaSpotter) Replaced the adapter icon with openWB's own official logo, used with permission.
- (SeaSpotter) Added an **Energy values shown as** setting (Wh/kWh display, Components tab).
- (SeaSpotter) Added several previously-missing chargepoint fields (actual charging
  current/power/voltage, max charge/discharge power, connected-vehicle range and SoC-reader fault
  fields) and made more control fields show their live, device-confirmed value.
- (SeaSpotter) Added `pv.total`/`chargepoint.total` system-wide sums and a `counter.homeConsumption`
  channel for openWB's estimated whole-house consumption.
- (SeaSpotter) Fixed `soc`/`socTimestamp` reading empty on real devices.
- (SeaSpotter) Translated every state and channel name into all 11 languages ioBroker supports.
- (SeaSpotter) **New-device check interval** now defaults to off.
- (SeaSpotter) Marked credential fields (`token`/`password`/`mqttPassword`) as protected in the
  admin UI.

### 0.1.0 (2026-09-22)

- (SeaSpotter) Reads now come from a live MQTT connection instead of HTTP polling - lower latency,
  reliable component discovery. Writes are unchanged (still HTTP).
- (SeaSpotter) Migrated the admin UI to `@iobroker/adapter-react-v5`/MUI 6, and merged the
  Connection/MQTT tabs into one.
- (SeaSpotter) Fixed a missing `"messagebox": true` that silently broke **Test connection** and
  **Probe now**.
- (SeaSpotter) Fixed the connection test timing out against real devices.
- (SeaSpotter) Fixed all cumulative energy fields being mislabeled as kWh - they're Wh on the wire.
- (SeaSpotter) Chargepoint control states now show their real, device-confirmed value instead of
  staying `null` until written. `batMode`/`batPowerReserve` moved under each battery's own control
  channel.
- (SeaSpotter) Newly discovered components are now added disabled, not enabled. Added a per-row
  Name column.
- (SeaSpotter) Added PV charging limit control, mirroring the existing instant-charging limit
  fields.

### 0.0.1 (2026-09-21)

- (SeaSpotter) initial release
