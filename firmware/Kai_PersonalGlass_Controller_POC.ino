/*
  Kai Personal Glass – sicherer Controller-Proof-of-Concept

  Benötigte Library:
    ArduinoJson 7.x

  Dieser Sketch bewegt absichtlich keine Motoren und öffnet keinen Hahn. Er
  testet das QR-/NFC-Protokoll unabhängig von der produktiven V4.4-Firmware.

  Serieller Test:
    TOKEN:KAI-G01  -> simuliert einen NFC-Lesevorgang an Position 1
    POUR:1          -> simuliert eine bestätigte Zapfung

  Die Web-App antwortet auf glass.detected mit glass.profile.apply. Bei einem
  unbekannten/abgelaufenen Token wird das normale Anlagenprofil verwendet.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include "PersonalGlassController.h"

PersonalGlassController personalGlass;
String inputLine;

void emitReady() {
  StaticJsonDocument<192> message;
  message["type"] = "system.ready";
  message["protocol"] = 2;
  message["firmware"] = "personal-glass-poc-1";
  message["machineId"] = "kai-tap-poc";
  message["state"] = "idle";
  serializeJson(message, Serial);
  Serial.println();
}

void emitPour(uint8_t slot) {
  const PersonalGlassController::FillProfile profile = personalGlass.profile();
  StaticJsonDocument<384> message;
  message["type"] = "pour.completed";
  message["slot"] = constrain(slot, 1, 6);
  message["glassMl"] = profile.glassMl;
  message["fillPercent"] = profile.fillPercent;
  message["volumeMl"] = profile.glassMl * profile.fillPercent / 100;
  message["temperatureC"] = 5.4;
  message["measurement"] = "estimated";
  personalGlass.appendPourIdentity(message);
  serializeJson(message, Serial);
  Serial.println();
  personalGlass.clear();  // Zuordnung nie versehentlich auf das nächste Glas übertragen.
}

void handleLine(String line) {
  line.trim();
  if (!line.length()) return;

  if (line.startsWith("TOKEN:")) {
    String token = line.substring(6);
    token.trim();
    personalGlass.emitDetected(Serial, token.c_str(), 1, "mock-nfc");
    return;
  }
  if (line.startsWith("POUR:")) {
    emitPour(constrain(line.substring(5).toInt(), 1, 6));
    return;
  }

  StaticJsonDocument<768> message;
  const DeserializationError error = deserializeJson(message, line);
  if (error) return;
  if (strcmp(message["type"] | "", "system.hello") == 0) emitReady();
  personalGlass.applyMessage(message);
}

void setup() {
  Serial.begin(115200);
  personalGlass.setNormalProfile(500, 4, 7);
  delay(400);
  emitReady();
}

void loop() {
  while (Serial.available()) {
    const char character = Serial.read();
    if (character == '\n') {
      handleLine(inputLine);
      inputLine = "";
    } else if (character != '\r' && inputLine.length() < 1024) {
      inputLine += character;
    }
  }
}
