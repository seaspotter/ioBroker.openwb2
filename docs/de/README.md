![Logo](../../admin/openwb2.png)
# ioBroker.openwb2

## openwb2 Adapter für ioBroker

Liest Ladepunkte, Zähler, Batterie, PV und Verbraucher von einem [openWB](https://openwb.de) 2
Wallbox-Controller live über MQTT aus und ermöglicht die Steuerung des Ladevorgangs (Lademodus,
Stromgrenzen, Sofortladen-Ziele, Ladepunkt-Sperre, Batteriemodus, IO-Ausgänge, ...) über dessen
`simpleAPI`-HTTP-Schnittstelle - direkt aus ioBroker heraus.

> **Hinweis:** Dies ist ein unabhängiger, von der Community gepflegter Adapter. Er steht in keiner
> Verbindung zur openWB GmbH & Co. KG und wird nicht von ihr unterstützt. "openWB" ist eine Marke des
> jeweiligen Inhabers; das Adapter-Icon ist ein eigenständiges Design (ein Haus, eine Wallbox und ein
> Auto, verbunden durch ein Ladekabel, als generisches Heim-Lade-Motiv) und keine Nachbildung oder
> Ableitung des openWB-eigenen Logos.

### Warum MQTT zum Lesen, HTTP zum Schreiben

Eine frühe Version dieses Adapters hat `simpleapi.php` für alles per HTTP abgefragt. Das
funktioniert, aber `simpleapi.php` startet serverseitig pro Anfrage einen neuen
`mosquitto_sub`-Prozess (ca. 1-2,5s pro Anfrage) und hat vor allem keine zuverlässige Möglichkeit,
herauszufinden, welche Komponenten-IDs tatsächlich existieren - jeder Lese-Endpunkt liefert für eine
nicht existierende ID genau dieselben Standard-Nullwerte wie für ein echtes, gerade untätiges Gerät;
es gibt also kein Signal, nach dem man suchen könnte. Bei MQTT gibt es beide Probleme nicht: openWB
veröffentlicht normalisierte Daten bereits unter `openWB/simpleAPI/#` (retained, sodass ein frisches
Abonnement sofort den aktuellen Zustand aller Werte liefert), und ein Topic für eine nicht
existierende ID kommt schlicht nie an - Erkennung wird dadurch kostenlos und zuverlässig, statt eine
wiederkehrende Netzwerkabfrage zu sein. Schreibvorgänge bleiben trotzdem auf HTTP: Die
Steuer-Schreibvorgänge von `simpleapi.php` (Lademodus, Stromgrenzen, ...) führen serverseitig ein
Read-Modify-Write des gesamten `charge_template`-JSON-Dokuments durch, und es gibt keinen Grund,
diese Logik nur wegen eines gelegentlichen HTTP-POSTs neu zu implementieren.

Eine Ausnahme ist IO - `openWB/simpleAPI/#` spiegelt es überhaupt nicht, daher abonniert der
IO-Lesepfad stattdessen direkt den rohen `openWB/io/states/+/get/#`-Namespace.

### Voraussetzungen

- openWB 2.x mit aktivierter `simpleAPI` und einem MQTT-Broker, der vom ioBroker-Host aus erreichbar
  ist (in der Regel bedient dasselbe Gerät sowohl den Broker als auch die HTTP-Schnittstelle).

### Konfiguration

Die Admin-Oberfläche hat zwei Reiter:

- **Connection** - ein gemeinsames Feld **Host / IP address** steuert sowohl die HTTP-Seite
  (Schreibvorgänge und der **Test connection**-Button) als auch die MQTT-Seite (Lesevorgänge) - in
  echten Installationen ist das immer dasselbe Gerät. Der Pfad zu `simpleapi.php` ist fest
  (`/openWB/simpleAPI/simpleapi.php`) und nicht konfigurierbar, da er sich nie ändert. **Test
  connection** prüft beide Hälften in einem Rutsch und meldet sie getrennt. Ein Abschnitt
  **Advanced** enthält alles, was die meisten Installationen nie anfassen müssen: HTTP-/MQTT-Ports,
  Anfrage-Timeout, HTTP-Authentifizierung (keine / Bearer-Token / Benutzername+Passwort) sowie
  MQTT-Benutzername/-Passwort - openWB bietet dafür keine eigene Oberfläche, das betrifft also nur,
  wer openWBs eigene Konfigurationsdateien von Hand bearbeitet hat.
- **Components** - die Tabelle zur Komponentenerkennung. Mit **Probe now** wird angezeigt, was die
  laufende MQTT-Verbindung bereits beobachtet hat; neu gefundene Ladepunkte/Zähler/Batterien/PV/
  Verbraucher/IO-Module werden als neue Zeilen hinzugefügt, **standardmäßig deaktiviert** - erst das
  Ankreuzen einer Zeile (und Speichern) legt tatsächlich deren Objekte an und beginnt die
  Nachverfolgung; die Erkennung schlägt nur vor, aktiviert aber nie von selbst. Über die Spalte
  **Name** kann eine Zeile benannt werden, wenn im Objektbaum mehr als die reine ID stehen soll -
  openWB meldet einen konfigurierten Namen über MQTT nur für Ladepunkte, Zähler/Batterien/PV/IO
  benötigen daher einen manuell vergebenen Namen. Eine nicht mehr benötigte Zeile kann deaktiviert
  oder entfernt werden; eine nicht mehr beobachtete Zeile wird nur markiert, nicht automatisch
  gelöscht, falls das Gerät nur vorübergehend offline ist. Eine ID kann auch von Hand hinzugefügt
  werden. Das Intervall **New-device check interval** wiederholt dieselbe "hinzufügen, aber
  deaktiviert"-Erkennung im Hintergrund (`0` schaltet es ab, Standard 24h), sodass ein neu
  angeschlossenes Gerät ohne Besuch der Konfigurationsseite in der Tabelle erscheint. In beiden
  Fällen startet die Adapterinstanz neu, sobald sich die Tabelle tatsächlich ändert (jede Änderung an
  der nativen Konfiguration startet eine ioBroker-Adapterinstanz neu) - neu hinzugefügte, aber
  deaktivierte Zeilen ändern am Verhalten des laufenden Adapters nichts, bis sie aktiviert werden.

### Objektstruktur

```
openwb2.0.info.connection                  boolean, true solange mit dem MQTT-Broker verbunden
openwb2.0.chargepoint.<id>.<field>          nur lesbar: power, voltages/currents/powers je Phase,
                                             soc, state_str, plug_state, charge_state, rfid,
                                             configName, ...
openwb2.0.chargepoint.<id>.control.<field>  schreibbar: chargemode, chargecurrent, chargepointLock,
                                             minimalPvSoc, minimalPermanentCurrent, maxPriceEco,
                                             instantChargingLimit/Amount/Soc,
                                             pvChargingLimit/Amount/Soc, vehicle
openwb2.0.counter.<id>.<field>              nur lesbar
openwb2.0.battery.<id>.<field>              nur lesbar
openwb2.0.battery.<id>.control.batMode           schreibbar, enum: min_soc_bat_mode / ev_mode / bat_mode
openwb2.0.battery.<id>.control.batPowerReserve   schreibbar, Zahl, W
openwb2.0.pv.<id>.<field>                   nur lesbar
openwb2.0.consumer.<id>.<field>             nur lesbar
openwb2.0.io.<id>.digital.<name>            schreibbar, boolean - <name> stammt aus der IO-Modul-Konfiguration
openwb2.0.io.<id>.analog.<name>             schreibbar, Zahl - <name> stammt aus der IO-Modul-Konfiguration
```

Lesbare Werte und schreibbare Steuerungen liegen in getrennten Kanälen (`chargepoint.<id>.*`
gegenüber `chargepoint.<id>.control.*`), damit die schreibbare Oberfläche leicht zu überblicken ist
und nicht mit gespiegelten Lesewerten verwechselt wird, die denselben zugrunde liegenden Wert
darstellen. `batMode`/`batPowerReserve` liegen aus Gründen der einheitlichen Struktur unter dem
`control`-Kanal jeder aktivierten Batterie-Instanz, obwohl openWB sie als eine einzige globale
Einstellung behandelt und nicht pro Batterie (das Schreiben über die Steuerung einer Batterie wirkt
sich auf dieselbe zugrunde liegende Einstellung aus, die auch eine zweite Batterie anzeigen würde).

Alle kumulativen Energiewerte (`imported`, `exported` sowie deren `daily_`/`monthly_`/
`yearly_`-Varianten) sind in **Wh** angegeben, wie es auch tatsächlich auf der Leitung ankommt - nicht
in kWh.

Die meisten Ladepunkt-Steuerwerte zeigen außerdem den echten, vom Gerät bestätigten aktuellen Wert
an (nicht nur ein Echo dessen, was zuletzt geschrieben wurde) - befüllt beim Start und kurz nach
jeder Änderung aktualisiert, egal ob sie von diesem Adapter oder von openWBs eigener Oberfläche kam.
`manualSoc` gibt es dafür nicht mehr: Das manuelle Setzen eines Ladestands hat keine Entsprechung, die
sich über MQTT zurücklesen lässt, daher wurde diese Steuerung entfernt statt sie dauerhaft auf `null`
stehen zu lassen.

### Bekannte Einschränkungen

- Die Komponentenerkennung fügt nur Zeilen hinzu, stets deaktiviert - sie aktiviert oder löscht nie
  etwas von selbst. Eine Zeile muss selbst angekreuzt (und gespeichert) werden, sobald bestätigt ist,
  dass es sich um das erwartete Gerät handelt.
- IO-Ausgangs-*Namen* werden vom Gerät gelesen (sie sind in openWBs eigener IO-Modul-Konfiguration
  benutzerdefiniert), daher erscheinen `io.<id>.digital.*`/`io.<id>.analog.*`-Objekte erst, nachdem
  der Adapter mindestens eine Nachricht für dieses IO-Modul empfangen hat.
- Für einige wenige nur lesbare Ladepunkt-Felder (`chargeTemplateName`, `minCurrent`,
  `instantChargingCurrent`, `pvChargingMinCurrent`) wurde bislang keine MQTT-Entsprechung gefunden;
  sie aktualisieren sich daher nicht - es handelt sich um kleinere Einstellungs-Spiegelungen, von
  denen der Schreibpfad nicht abhängt.
- Die MQTT-Broker-Verbindung hat in der Admin-Oberfläche aktuell keine TLS-Option - nur einfaches
  `mqtt://`.

## Changelog

Siehe die englische [README.md](../../README.md#changelog) für den vollständigen Änderungsverlauf.

## Lizenz
MIT License

Copyright (c) 2026 SeaSpotter <seatowage@gmail.com>
