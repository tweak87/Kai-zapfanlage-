# Kai Tap Serial Protocol 1.0 (Vorschlag)

Das Protokoll ist für Web Serial über USB vorgesehen. Die aktuelle Firmware V4.4 implementiert es noch nicht. Die Webanwendung enthält bereits einen Client für dieses Format.

## Transport

- 115200 Baud
- 8 Datenbits, keine Parität, 1 Stoppbit
- UTF-8
- genau ein JSON-Objekt pro Zeile (`\n`)
- maximale Nachrichtenlänge empfohlen: 1024 Byte
- Protokollversion: `1`

Unbekannte Nachrichtentypen werden ignoriert und dürfen nicht zum Stopp der Anlage führen.

## Verbindung

Webseite an ESP32:

```json
{"type":"system.hello","client":"kai-tap-web","protocol":1}
```

ESP32 an Webseite:

```json
{"type":"system.ready","protocol":1,"firmware":"4.5.0","machineId":"kai-tap-01","state":"idle"}
```

## Statusmeldungen

```json
{"type":"state","state":"pouring","phase":"pour","slot":3,"progress":0.62,"glassPresent":true}
```

Erlaubte Phasen der ersten Version:

- `scan`
- `lower`
- `pour`
- `foam`
- `rotate`
- `home`
- `idle`
- `fault`

Temperatur:

```json
{"type":"temperature","valueC":5.4,"sensor":"beer-line"}
```

Abgeschlossene Zapfung:

```json
{"type":"pour.completed","slot":3,"glassMl":500,"volumeMl":487,"fillPercent":97,"temperatureC":5.4,"measurement":"estimated"}
```

`measurement` sollte später einen der Werte `estimated`, `flow` oder `weight` besitzen. Solange kein Sensor eingebaut ist, muss die Firmware `estimated` melden.

Zyklusende:

```json
{"type":"cycle.completed","cycleId":"2026-08-29T18:42:11Z-17","pours":6,"skipped":0}
```

Fehler:

```json
{"type":"fault","code":"ENDSTOP_TIMEOUT","message":"Oberer Endschalter nicht erreicht","recoverable":false}
```

## Befehle

Zyklus starten:

```json
{"type":"cycle.start","slots":6,"requestId":"web-42"}
```

Sicher stoppen:

```json
{"type":"cycle.stop","reason":"web-ui","requestId":"web-43"}
```

Einstellungen lesen:

```json
{"type":"settings.get","requestId":"web-44"}
```

Einstellungen aktualisieren:

```json
{
  "type":"settings.update",
  "requestId":"web-45",
  "physicalConfirmation":true,
  "settings":{
    "targetVolumeMl":500,
    "flowRate":7,
    "foamLevel":4,
    "fillHeight":8,
    "liftSpeed":9,
    "tapDelay":2
  }
}
```

Die Firmware muss jeden Wert erneut auf einen sicheren Bereich begrenzen. Die Webseite ist niemals die Sicherheitsinstanz.

## Bestätigung und Korrelation

Jeder schreibende Befehl trägt eine `requestId`. Der ESP32 antwortet mit:

```json
{"type":"ack","requestId":"web-45","accepted":true,"pendingPhysicalConfirmation":true}
```

oder:

```json
{"type":"ack","requestId":"web-45","accepted":false,"error":"OUT_OF_RANGE"}
```

## Sicherheitsregeln der Firmware

1. Not-Aus und lokale Hardwaretaster haben Vorrang vor Webbefehlen.
2. Verbindungsverlust darf niemals Hahn oder Motor in einem unsicheren Zustand lassen.
3. Zeitlimits gelten für jeden Fahr- und Zapfzustand.
4. Parameter werden auf feste Firmwaregrenzen begrenzt.
5. Servicebefehle wie Referenzfahrt oder manuelles Fahren benötigen physischen Wartungsmodus.
6. Optional muss Enter an der Anlage innerhalb eines kurzen Zeitfensters bestätigen, bevor Einstellungen übernommen werden.
7. Nach Neustart werden nur vollständig validierte, versionierte EEPROM-Daten geladen.
