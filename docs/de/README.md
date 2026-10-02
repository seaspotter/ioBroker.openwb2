![Logo](../../admin/openwb2.png)

# ioBroker.openwb2

## openwb2 Adapter für ioBroker

Liest Ladepunkte, Zähler, Batterie, PV und Verbraucher von einem [openWB](https://openwb.de) 2
Wallbox-Controller live über MQTT aus und ermöglicht die Steuerung des Ladevorgangs über dessen
`simpleAPI`-HTTP-Schnittstelle - direkt aus ioBroker heraus.

> **Hinweis:** Dies ist ein unabhängiger, von der Community gepflegter Adapter. Er steht in keiner
> Verbindung zur openWB GmbH & Co. KG und wird nicht von ihr unterstützt. "openWB" ist eine Marke des
> jeweiligen Inhabers; das Adapter-Icon ist das offizielle openWB-Logo, mit Genehmigung von openWB
> verwendet.

### Lesen über MQTT, Schreiben über HTTP

Dieser Adapter liest Live-Daten aus openWBs MQTT-Broker (`openWB/simpleAPI/#`) und sendet
Steuerbefehle über dessen `simpleAPI`-HTTP-Schnittstelle (`simpleapi.php`). Beide müssen vom
ioBroker-Host aus erreichbar sein.

### Voraussetzungen

- openWB 2.3 oder neuer - `simpleAPI` ist auf diesen Versionen immer aktiv, nichts zu aktivieren.

### Konfiguration

Die Admin-Oberfläche hat zwei Reiter:

- **Connection** - ein gemeinsames Feld **Host / IP address** für sowohl die HTTP- als auch die
  MQTT-Verbindung (in der Regel dasselbe Gerät). **Test connection** prüft beide und meldet sie
  getrennt. **Advanced** enthält HTTP-/MQTT-Ports, Timeouts und Authentifizierung - nur relevant,
  wenn du openWBs eigene Konfigurationsdateien von Hand angepasst hast.
- **Components** - die Tabelle zur Geräteerkennung. **Probe now** fügt neu gefundene Ladepunkte,
  Zähler, Batterien, PV-Module und Verbraucher als neue Zeilen hinzu, standardmäßig deaktiviert -
  Zeile ankreuzen und Speichern aktiviert sie und legt ihre Objekte an. Über die Spalte **Name**
  kann eine Zeile benannt werden (openWB meldet einen Namen über MQTT nur für Ladepunkte). Eine
  nicht mehr benötigte Zeile kann deaktiviert oder entfernt werden; eine nicht mehr beobachtete
  Zeile wird nur markiert, nicht gelöscht. Eine ID kann auch von Hand hinzugefügt werden.
  **New-device check interval** wiederholt die Erkennung im Hintergrund (standardmäßig aus).
  **Energy values shown as** schaltet jeden kumulativen Energiezähler instanzweit zwischen `Wh`
  (Standard) und `kWh` um.

### Objektstruktur

```
openwb2.0.info.connection                  boolean, true solange mit dem MQTT-Broker verbunden
openwb2.0.chargepoint.<id>.<field>          nur lesbar: power, voltages/currents/powers je Phase,
                                             soc, state_str, plug_state, charge_state, rfid,
                                             configName, ...
openwb2.0.chargepoint.<id>.control.<field>  schreibbar: chargemode, chargepointLock, maxPriceEco,
                                             instantChargingCurrent/Limit/Amount/Soc,
                                             pvChargingLimit/Amount/Soc/MinCurrent/MinSoc, vehicle
openwb2.0.counter.<id>.<field>              nur lesbar
openwb2.0.battery.<id>.<field>              nur lesbar
openwb2.0.battery.<id>.control.batMode           schreibbar, enum: min_soc_bat_mode / ev_mode / bat_mode
openwb2.0.battery.<id>.control.batPowerReserve   schreibbar, Zahl, W
openwb2.0.pv.<id>.<field>                   nur lesbar
openwb2.0.consumer.<id>.<field>             nur lesbar
openwb2.0.pv.total.<field>                  nur lesbar: power, exported, monthlyExported, yearlyExported -
                                             systemweite Summe über alle aktivierten PV-Module
openwb2.0.chargepoint.total.<field>         nur lesbar: power, imported, exported - systemweite Summe über
                                             alle aktivierten Ladepunkte
openwb2.0.counter.homeConsumption.<field>   nur lesbar: power, dailyConsumption, totalConsumption,
                                             excludedPower, disengageableSmarthomePower, invalidReadings -
                                             openWBs eigene geschätzte Hausverbrauchssumme (kein physischer
                                             Zähler); immer angelegt, bleibt null, wenn openWB dies nicht
                                             berechnet
```

Lesbare Werte und schreibbare Steuerungen liegen in getrennten Kanälen (`chargepoint.<id>.*`
gegenüber `chargepoint.<id>.control.*`). `batMode`/`batPowerReserve` liegen unter dem
`control`-Kanal jeder Batterie-Instanz, auch wenn die Einstellung global für alle Batterien gilt.

Energiezähler (`imported`/`exported` sowie deren `daily_`/`monthly_`/`yearly_`-Varianten) sind
standardmäßig in **Wh** - Umschaltung auf `kWh` im Components-Reiter.

Die meisten Ladepunkt-Steuerwerte zeigen außerdem den echten, vom Gerät bestätigten Wert, nicht nur
ein Echo dessen, was zuletzt geschrieben wurde.

### Bekannte Einschränkungen

- Die Komponentenerkennung fügt nur Zeilen hinzu, stets deaktiviert - sie aktiviert oder löscht nie
  etwas von selbst.
- Die MQTT-Broker-Verbindung hat in der Admin-Oberfläche aktuell keine TLS-Option - nur einfaches
  `mqtt://`.

## Changelog

Siehe die englische [README.md](../../README.md#changelog) für den vollständigen Änderungsverlauf.

## Lizenz

MIT License

Copyright (c) 2026 SeaSpotter <seatowage@gmail.com>
