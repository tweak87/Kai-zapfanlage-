# Personal Glass – Mockup, Hardware und Zielarchitektur

## Ergebnis des Proof of Concept

Der persönliche Modus ist eine **optionale Schicht** über dem bestehenden Zapfablauf. Ein Glas ohne gültige Zuordnung wird weiterhin anonym mit dem normalen Anlagenprofil gefüllt. Ein erkanntes, gültig zugeordnetes Glas erhält ein begrenztes persönliches Profil.

Das Mockup kann bereits:

- lokale Testprofile anmelden und neue Profile anlegen,
- neutrale Glas-IDs per Eingabe, Mock-Scan oder URL-Parameter übernehmen,
- echte QR-Codes lokal erzeugen und als PNG-Etikett herunterladen,
- QR-Codes mit der Handy-Rückkamera direkt in der Web-App erkennen,
- Glasgröße, Füllwunsch und Schaumniveau speichern,
- Zuordnungen auf das aktuelle Event und eine maximale Laufzeit begrenzen,
- belegte Tokens gegen Übernahme durch andere Profile schützen,
- Gläser vorzeitig freigeben und anschließend neu registrieren,
- persönliche Zapfungen, Gesamtmenge, Eventmenge und den besten Eventwert auswerten,
- XP, Level und Abzeichen für Registrierung, Präzision, Rondellnutzung und Mehrweg vergeben,
- ein neues Event starten, wodurch alte Zuordnungen sofort inaktiv werden,
- im Personal-Glass-Testszenario drei Profile und anonyme Gläser gemeinsam simulieren.

Die Daten liegen im Proof of Concept nur im `localStorage` des geöffneten Browsers. Das ist absichtlich transparent, aber weder eine echte Anmeldung noch geräteübergreifend.

## Empfohlene Identifikation: QR am Handy, NFC an der Anlage

Die robusteste Kombination nutzt denselben neutralen Token auf zwei Wegen:

| Ort | Technik | Zweck |
|---|---|---|
| Handy des Gasts | QR-Code oder NFC-NDEF-Link | Registrierungsseite öffnen und persönliches Profil wählen |
| Zapfanlage | NFC-Leser PN532 | Glas vor der Füllung kurzreichweitig und lageunabhängig erkennen |
| Fallback | aufgedruckte Glas-ID | manuelle Eingabe, falls Kamera oder NFC nicht verfügbar ist |

Der QR-/NFC-Inhalt ist nur ein HTTPS-Link, zum Beispiel:

```text
https://tweak87.github.io/Kai-zapfanlage-/?glass=KAI-G04#personal
```

Der Token enthält **keinen Namen, keine E-Mail und kein Füllprofil**. Ein unveränderter Tag kann deshalb bei vielen Events erneut eingesetzt werden.

Der Kamerascanner nutzt `getUserMedia()` und wertet jedes Bild mit der lokal eingebundenen Bibliothek jsQR direkt im Browser aus. Kamerabilder werden weder gespeichert noch hochgeladen. GitHub Pages liefert die dafür notwendige HTTPS-Verbindung. Wird der Kamerazugriff abgelehnt, bleiben die normale Handy-Kamera, der Mock-Scan und die manuelle Eingabe verfügbar.

Die QR-Erzeugung läuft ebenfalls lokal. Für ein echtes Etikett wird eine Glas-ID eingetragen, der QR-Code erzeugt und als PNG geladen. Der Code sollte zusätzlich lesbar aufgedruckt werden, damit ein beschädigtes Etikett manuell eingegeben werden kann.

## Gamification ohne Trinkanreiz

Die App trennt Mengeninformation und Spielmechanik bewusst. Liter werden weiterhin persönlich dokumentiert, erhöhen aber weder Level noch Qualitäts-Highscore. Belohnt werden:

- Registrierung eines wiederverwendbaren Glases,
- Füllungen innerhalb des persönlichen Zielbands,
- Nutzung verschiedener Rondellpositionen,
- Wiederverwendung desselben Glases bei einem späteren Event.

Der Event-Highscore vergleicht die mittlere Füllpräzision von 0 bis 100 Punkten. Damit entsteht ein spielerischer Qualitätsvergleich, ohne möglichst hohen Konsum zum Ziel zu machen.

## Hardwarevorschlag

### Empfohlener erster Aufbau

| Komponente | Empfehlung | Begründung |
|---|---|---|
| NFC-Leser | PN532-Modul, 13,56 MHz, ISO/IEC 14443 A | kurze definierte Reichweite, liest NTAG213/215, flexibler als der sehr günstige RC522 |
| Glastag | NTAG213- oder NTAG215-Inlay in wasserdichter PET-/Epoxid-Ausführung | genügend Speicher für NDEF-URL; UID kann maschinell als Token dienen |
| QR-Fallback | abrieb- und wasserfester QR-Aufkleber mit Klarlaminat | funktioniert mit der normalen Handykamera und ohne App |
| Halterung | abnehmbarer Silikonring am unteren Glasbereich oder 3D-gedruckter Fußclip | Tag ist austauschbar; kein Kleber am Trinkrand; Glas bleibt einfacher zu reinigen |
| Identitäts-Gateway | optional ein separates ESP32-C3-Modul | entkoppelt NFC-Leser und Netzwerk vom zeitkritischen V4.4-Motorprogramm |
| Mengenmessung | 5-kg-Wägezelle plus HX711 an der Füllposition | macht persönliche Milliliterwerte statt Schätzwerte möglich |
| Gesamtplausibilität | Fasswaage mit 50-kg-Wägezelle und HX711 | erkennt Fassrest und Schankverlust unabhängig von einzelnen Gläsern |

Vor dem Kauf müssen die konkrete Glasform, Spültemperatur, Reinigungschemie und der Abstand zur Leserantenne getestet werden. Ein als „wasserdicht“ beworbener Tag ist nicht automatisch spülmaschinen- oder lebensmitteltauglich. Die Kennzeichnung gehört nicht an den Trinkrand und sollte für die Reinigung abnehmbar sein.

### Ein Leser statt sechs Leser

Empfohlen ist eine feste Leseposition direkt vor oder an der Zapfposition. Das Rondell führt jedes Glas nacheinander daran vorbei. Die kurze NFC-Reichweite verhindert, dass Nachbargläser gleichzeitig erkannt werden. Sechs Leser würden Kosten, Verkabelung, Funkkopplung und Fehlerdiagnose unnötig erhöhen.

Die Antenne sollte unter einer nichtmetallischen Auflage sitzen. Wasser und Metall verstimmen NFC-Antennen; deshalb müssen Tagposition, Abstand und Leserleistung mit gefüllten und leeren Gläsern praktisch vermessen werden.

### Warum nicht nur QR an der Anlage?

QR ist ideal für die Registrierung per Handy. An einer Maschine sind Blickwinkel, Kondenswasser, drehende Gläser und wechselndes Licht jedoch ungünstig. Eine Kameraeinheit ist zudem rechen- und wartungsintensiver. NFC ist dort schneller und reproduzierbarer. QR bleibt der hervorragende Fallback.

## Ablauf und automatischer Verfall

1. Ein Admin startet ein Event mit eigener `eventId` und Endzeit.
2. Der Gast öffnet den QR-/NFC-Link und meldet sich an.
3. Das Backend bindet `tokenId + userId + eventId` bis zum früheren Zeitpunkt aus Eventende oder Zuordnungs-TTL.
4. Der Leser meldet nur `tokenId` und Rondellposition.
5. Web-App beziehungsweise lokales Gateway prüft Event und Ablaufzeit.
6. Bei gültiger Bindung erhält der Controller nur `assignmentId`, `eventId`, Ablaufdauer und begrenzte Füllwerte.
7. Nach der Zapfung löscht der Controller das aktive Profil, damit es nicht auf das nächste Glas übergeht.
8. Bei abgelaufener/fehlender Bindung gilt automatisch das normale Anlagenprofil.
9. Ein neues Event hat eine neue `eventId`; damit sind sämtliche alten Bindungen ohne Umschreiben der Tags ungültig.

Eine vorzeitige Freigabe setzt den Status auf `released`. Ein Benutzer kann danach dasselbe oder ein neues Glas registrieren. Ein aktiver Token darf innerhalb eines Events nicht von einem anderen Benutzer übernommen werden.

## Controller-Vorbereitung

Die produktive Datei `Kai_Zapfanlage_V4_4.ino` bleibt unangetastet, damit keine ungeprüfte Änderung Motoren oder Hahn ansteuert. Neu enthalten sind:

- `PersonalGlassController.h`: kurzlebiger Profil-Cache, Wertebegrenzung, Normalmodus-Fallback und Identitätsfelder für das Abschluss-Telegramm.
- `Kai_PersonalGlass_Controller_POC.ino`: gefahrloser Protokolltest ohne Aktoren; simuliert NFC mit `TOKEN:KAI-G01` und eine Zapfung mit `POUR:1`.

Für die reale Integration muss der V4.4-Ablauf zunächst in eine nicht blockierende Zustandsmaschine überführt werden. Direkt vor `BierZapfen()` wird der Token gelesen und ein Profil maximal wenige Sekunden angefragt. Ohne rechtzeitige Antwort darf der Zyklus nur das normale Profil verwenden oder – je nach Sicherheitsentscheidung – dieses Glas überspringen.

Die vorhandene V4.4-Pinbelegung ist bereits dicht und SPI/I²C werden von Display, TMC5160 und MCP23X17 verwendet. Deshalb sollten PN532-Pins nicht ohne Messung und Schaltplanprüfung fest vergeben werden. Für den ersten Hardwaretest ist ein separates ESP32-C3-Identitätsmodul oder ein lokales Gateway risikoärmer; danach kann geprüft werden, ob der PN532 störungsfrei den vorhandenen I²C-Bus teilen kann.

## Benötigtes Backend für den echten Mehrbenutzerbetrieb

GitHub Pages kann das Frontend ausliefern, aber keine sicheren Konten oder gemeinsame Eventdaten verwalten. Die produktive Ausbaustufe benötigt mindestens:

- Anmeldung mit E-Mail, Passkey oder Eventcode und getrennten Adminrechten,
- Tabellen für Benutzer, Events, Glas-Tokens, zeitbegrenzte Zuordnungen und Zapfungen,
- serverseitige Prüfung, dass Token, Benutzer und Event zusammenpassen,
- sofortige Sperre und automatische Ablaufbereinigung,
- datensparsame Aufbewahrungs- und Löschfristen,
- lokales Anlagen-Gateway mit Offlinepuffer und gesicherter Geräteidentität,
- Audit-Log für Eventwechsel und Parameteränderungen.

Der ESP32 darf keine Passwörter, Namen oder dauerhaften Benutzerprofile speichern und sollte nicht direkt aus dem Internet erreichbar sein.

Die lokal eingebundenen QR-Bibliotheken und ihre Lizenzen sind in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dokumentiert.

## Empfohlene Ausbaureihenfolge

1. Zehn Gläser mit abnehmbaren NFC-/QR-Ringen aufbauen und Lesereichweite testen.
2. POC-Sketch mit Web Serial gegen die veröffentlichte Seite testen.
3. Wägezelle kalibrieren, damit persönliche Mengen tatsächlich gemessen werden.
4. lokales Event-Gateway und echtes Login/Backend ergänzen.
5. V4.4 in eine sichere Zustandsmaschine umbauen und Profilabruf integrieren.
6. Pilot-Event mit Ablauf, Freigabe, Offlinefall, Not-Aus und Datenschutz-Löschung testen.
