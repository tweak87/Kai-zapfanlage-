# Kai Tap Control

Moderne Bedien-, Test- und Auswertungsoberfläche für die Kai-Zapfanlage. Die erste Ausbaustufe läuft vollständig als Arduino-Mock im Browser und ist für eine spätere Web-Serial-Verbindung mit dem ESP32 vorbereitet.

Der optionale **Personal-Glass-Modus** ergänzt zeitlich begrenzte QR-/NFC-Glaszuordnungen, persönliche Füllprofile und Eventstatistiken. Der normale anonyme Betrieb bleibt vollständig erhalten.

## Sofort ausprobieren

1. Die veröffentlichte GitHub Page öffnen.
2. Unter **Betrieb** ein Testszenario auswählen.
3. **6er-Zyklus starten** drücken.
4. Zapfungen je Rondellplatz, Füllstand, geschätzte Biermenge und Historie beobachten.
5. Den Adminbereich mit der Mockup-PIN `2468` öffnen.

Alle Daten bleiben zunächst im lokalen Browserspeicher. Die Historie kann als CSV exportiert werden. Die Oberfläche ist als installierbare, offlinefähige Web-App vorbereitet.

## Funktionsumfang des Web-Mockups

- realistische Simulation des bestehenden Sechs-Positionen-Ablaufs
- Rondellansicht mit Glas erkannt, Position aktiv und Glas fehlt
- Live-Phasen: prüfen, absenken, zapfen, Schaum dosieren und weiterdrehen
- Testszenarien für volle, gemischte, fehlende und unterfüllte Gläser sowie ein leer werdendes Fass
- Statistik je Rondellposition
- Gesamtzahl, geschätzte Biermenge, durchschnittlicher Füllstand und Fassrest
- positionsgenaue Zapfhistorie mit CSV-Export
- Qualitätsauswertung mit konfigurierbarem Zielband
- Reinigungszähler und Wartungshinweis
- lokaler PIN-geschützter Adminbereich
- Einstellungen für Füllmenge, Durchfluss, Schaum, Füllhöhe, Geschwindigkeit, Anzapfzeit, Rondell, Temperatur und Wartung
- vorbereiteter Web-Serial-Transport für Chrome/Edge mit JSON-Telegrammen bei 115200 Baud
- lokaler Profil- und Login-Mock für den Proof of Concept
- Registrierungslinks im Format `?glass=KAI-G04#personal` für QR und NFC-NDEF
- eventgebundene Glaszuordnungen mit automatischem Ablauf und manueller Freigabe
- persönliche Füllwünsche, Zapfstatistik und Event-Highscore
- gemischtes Testszenario aus personalisierten, anonymen und fehlenden Gläsern

## Wichtige Grenze der aktuellen Messung

Die vorhandene Anlage besitzt keinen Mengen- oder Gewichtssensor. Daher sind Milliliter, Füllprozent und Fassrest im Mockup simulierte beziehungsweise aus dem Füllprofil abgeleitete Werte. Für belastbare Echtwerte wird mindestens eine der folgenden Erweiterungen benötigt:

- **Wägezelle an der Füllposition:** gute Messung je Glas, benötigt mechanische Entkopplung vom Schlitten/Rondell.
- **Lebensmitteltauglicher Durchflusssensor:** direkte Mengenmessung in der Bierleitung, muss für Druck, Schaum und Reinigung geeignet sein.
- **Fasswaage:** robuste Kontrolle der Gesamtmenge und Restmenge, aber nicht allein positionsgenau.

Eine Kombination aus Glas- oder Durchflussmessung und Fasswaage liefert die beste Plausibilisierung.

## Projektstruktur

```text
assets/                 Weboberfläche, Datenmodell und Web Serial
docs/                   Bestandsanalyse und Schnittstellenvertrag
firmware/               Unveränderter Arduino-Bestand V4.4
                        plus gefahrloser Personal-Glass-Protokoll-POC
scripts/                Build- und Validierungswerkzeuge
tests/                  Automatisierte Modell- und Protokolltests
.github/workflows/      Qualitätsprüfung, Auto-Merge und Pages-Deployment
```

## Lokal starten und prüfen

Benötigt wird Node.js 20 oder neuer.

```bash
npm test
npm run build
npx serve dist
```

Alternativ kann `index.html` über einen beliebigen lokalen HTTP-Server geöffnet werden. Web Serial funktioniert nur in einem sicheren Kontext (HTTPS oder localhost) und benötigt eine bewusste Geräteauswahl durch den Benutzer.

## Veröffentlichungsablauf

- **Quality checks** prüft Tests, JavaScript-Syntax, Pflichtdateien und interne Links bei Pull Requests.
- **Safe auto-merge** aktiviert Squash-Auto-Merge nur für nicht-entworfene Branches des Repository-Inhabers mit dem Präfix `codex/`.
- **Deploy GitHub Pages** testet und baut nach jedem Merge in `main`, lädt das statische Artefakt hoch und veröffentlicht es über GitHub Pages.

## Dokumentation

- [Heutige Steuerung und Zielarchitektur](docs/CURRENT_AND_TARGET.md)
- [Web-Serial-JSON-Protokoll](docs/SERIAL_PROTOCOL.md)
- [Personal Glass: Ablauf, Hardware und Backend](docs/PERSONAL_GLASS.md)
- [Originaler Arduino-Code V4.4](firmware/Kai_Zapfanlage_V4_4.ino)
- [Controller-Proof-of-Concept](firmware/Kai_PersonalGlass_Controller_POC.ino)

## Sicherheit

Der PIN-Schutz dieser statischen GitHub Page ist ein Bedien- und Fehlbedienungsschutz, keine sichere Benutzeranmeldung: Der Browser besitzt den Anwendungscode und den lokalen Einstellungsstand. Für eine echte Anlage sollten schreibende Befehle zusätzlich von der Firmware validiert, auf sichere Werte begrenzt und optional durch eine physische Freigabe an der Anlage bestätigt werden. Externer Mehrbenutzerzugriff erfordert einen authentifizierten Backenddienst.

Auch der Profil-Login im Mockup ist nur eine lokale Simulation. Glas-Tags enthalten ausschließlich neutrale IDs; Namen, Passwörter oder dauerhafte Profile gehören weder auf den Tag noch in den Anlagencontroller.
