#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

// POC-Erweiterung für Kai Zapfanlage V4.4.
// Bewusst ohne Namen oder andere personenbezogene Daten: Der Controller kennt
// nur eine kurzlebige Zuordnungs-ID und ein begrenztes Füllprofil.
class PersonalGlassController {
 public:
  struct FillProfile {
    uint16_t glassMl = 500;
    uint8_t fillPercent = 100;
    uint8_t foamLevel = 4;
    uint8_t flowRate = 7;
  };

  void setNormalProfile(uint16_t glassMl, uint8_t foamLevel, uint8_t flowRate) {
    normal_.glassMl = constrain(glassMl, 200, 1000);
    normal_.fillPercent = 100;
    normal_.foamLevel = constrain(foamLevel, 1, 10);
    normal_.flowRate = constrain(flowRate, 1, 10);
  }

  void emitDetected(Stream &out, const char *tokenId, uint8_t slot, const char *reader = "nfc") {
    StaticJsonDocument<192> message;
    message["type"] = "glass.detected";
    message["tokenId"] = tokenId;
    message["slot"] = constrain(slot, 1, 6);
    message["reader"] = reader;
    serializeJson(message, out);
    out.println();
  }

  // Erwartet glass.profile.apply aus der Web-App bzw. später vom Event-Gateway.
  // Rückgabe true bedeutet: Nachricht erkannt und sicher übernommen.
  bool applyMessage(JsonDocument &message) {
    if (strcmp(message["type"] | "", "glass.profile.apply") != 0) return false;
    const char *token = message["tokenId"] | "";
    if (!validToken(token)) {
      clear();
      return true;
    }
    if (message["fallback"] || message["assignmentId"].isNull()) {
      copyText(token_, token, sizeof(token_));
      clearAssignmentOnly();
      return true;
    }

    copyText(token_, token, sizeof(token_));
    copyText(assignmentId_, message["assignmentId"] | "", sizeof(assignmentId_));
    copyText(eventId_, message["eventId"] | "", sizeof(eventId_));
    JsonObject profile = message["profile"];
    active_.glassMl = constrain(profile["glassMl"] | normal_.glassMl, 200, 1000);
    active_.fillPercent = constrain(profile["fillPercent"] | 100, 60, 100);
    active_.foamLevel = constrain(profile["foamLevel"] | normal_.foamLevel, 1, 10);
    active_.flowRate = constrain(profile["flowRate"] | normal_.flowRate, 1, 10);
    const uint32_t ttlSeconds = constrain(message["ttlSeconds"] | 1, 1, 259200);
    validUntilMs_ = millis() + ttlSeconds * 1000UL;
    assigned_ = assignmentId_[0] != '\0';
    return true;
  }

  bool isPersonalized() {
    if (assigned_ && static_cast<int32_t>(millis() - validUntilMs_) >= 0) clearAssignmentOnly();
    return assigned_;
  }

  FillProfile profile() {
    return isPersonalized() ? active_ : normal_;
  }

  const char *tokenId() const { return token_; }
  const char *assignmentId() const { return assignmentId_; }
  const char *eventId() const { return eventId_; }

  void appendPourIdentity(JsonDocument &message) {
    if (!isPersonalized()) return;
    message["glassToken"] = token_;
    message["assignmentId"] = assignmentId_;
    message["eventId"] = eventId_;
  }

  void clear() {
    token_[0] = '\0';
    clearAssignmentOnly();
  }

 private:
  FillProfile normal_;
  FillProfile active_;
  char token_[33] = "";
  char assignmentId_[121] = "";
  char eventId_[121] = "";
  uint32_t validUntilMs_ = 0;
  bool assigned_ = false;

  static void copyText(char *target, const char *source, size_t capacity) {
    if (!capacity) return;
    strncpy(target, source ? source : "", capacity - 1);
    target[capacity - 1] = '\0';
  }

  static bool validToken(const char *value) {
    const size_t length = value ? strlen(value) : 0;
    if (length < 3 || length > 32) return false;
    for (size_t index = 0; index < length; index++) {
      const char c = value[index];
      if (!(isAlphaNumeric(c) || c == '-' || c == '_')) return false;
    }
    return true;
  }

  void clearAssignmentOnly() {
    assignmentId_[0] = '\0';
    eventId_[0] = '\0';
    validUntilMs_ = 0;
    assigned_ = false;
    active_ = normal_;
  }
};
