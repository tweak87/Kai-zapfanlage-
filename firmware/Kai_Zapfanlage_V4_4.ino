

#include <Adafruit_GFX.h>  // Core graphics library
#include <Adafruit_ST7735.h>
#include <SPI.h>
#include <TMCStepper.h>
#include <Arduino.h>
#include <ESP32Servo.h>
#include <EEPROM.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_MCP23X17.h>
#include <Adafruit_NeoPixel.h>

//   Display
#define TFT_CS 5
#define TFT_RST 0
#define TFT_DC 16
#define BL 4

Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);
Adafruit_MCP23X17 mcp;

//  Stepper 1
#define DIR1_PIN 25   // Direction
#define STEP1_PIN 26  // Step
#define CS1_PIN 27    // Chip select
#define Endschalter 13
#define R_SENSE 0.075f
TMC5160Stepper driver(CS1_PIN, R_SENSE);


//  Stepper 2
//#define DIR2_PIN 17    // Direction
#define STEP2_PIN 14  // Step
#define CS2_PIN 15    // Chip select
//#define Position 7
//#define Position2 9
TMC5160Stepper driverb(CS2_PIN, R_SENSE);

#define Entriegelung 11
#define IRA 33

//Servos
#define PIN_SERVO1 2
#define PIN_SERVO2 4
Servo myservoA;
Servo myservoB;

// Taster
#define Hoch 6
#define Runter 5
#define Links 3
#define Rechts 7
#define Enter 2
#define Zapfenstarten 8
#define Zapfenbeenden 0
#define Reed 15
#define Reed2 14
#define Nullstellung 10
#define FassSchlauch 0
#define Messung 9

// DS18B20
#define TempPin 32
OneWire oneWire(TempPin);
DallasTemperature sensors(&oneWire);

// WS2812
#define LED_PIN 17
#define LED_COUNT 122
//Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

#define EEPROM_SIZE 64
#define displayAktualisierung 1000
#define Vsmin 100
#define Vsmax 800
#define runterfahrGeschwindigkeit 10
#define GlasDaToleranz 1000
#define GlasVoll 600
#define GlasVollToleranz 100
#define KompensatorMin 10   //Max Durchfluss
#define KompensatorMax 160  //Min Durchfluss
#define HahnVor 30
#define HahnNull 110
#define HahnZuruck 140
#define StepsBisNull 500
#define StepsBisfehler 2000
#define Anfangssenkung 2000  // Schlitten etwas nach unten fahren
#define Schritte 8
#define Schrittfaktor 600

int i, bieregezapft, z, zz, Fullmenge, Temperatur, TemperaturZehntel, Steps, GlasDa, fullhohezapfen;

bool zapfvorgangGestartet, zapfvorgangAktiv, stepper1aktuell, fehler, reedalesen, reedblesen, warvorher, halbes;

byte Empfindlichkeit, anzapfzeit, Durchflussrate, hochfahrGeschwindigkeit, fullhohe, schaumniveau;

byte menupunkt = 1;

unsigned long aktuelleZeit, letzteAktualisierung, aktuelleMicros, letzteMicros;

float temperature;

void setup(void) {
  delay(2000);
  EEPROM.begin(EEPROM_SIZE);
  //Vorladen
  //EEPROM.write(0, 5);
  //EEPROM.write(1, 5);
  //EEPROM.write(2, 9);
  //EEPROM.write(3, 90);
  //EEPROM.write(4, 2);
  //EEPROM.write(5, 5);
  //EEPROM.commit();
  Durchflussrate = EEPROM.read(0);
  schaumniveau = EEPROM.read(1);
  fullhohe = EEPROM.read(2);
  hochfahrGeschwindigkeit = EEPROM.read(3);
  anzapfzeit = EEPROM.read(4);

  GlasDa = map(Empfindlichkeit, 1, 250, 0, 4095);
  /*strip.begin();  // INITIALIZE NeoPixel strip object (REQUIRED)
  strip.show();   // Turn OFF all pixels ASAP
  strip.setBrightness(255);
  for (int i = 0; i < strip.numPixels(); i++) {     // For each pixel in strip...
    strip.setPixelColor(i, strip.Color(30, 0, 0));  //  Set pixel's color (in RAM)
  }
  strip.show();*/
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(400000);
  mcp.begin_I2C();
  SPI.begin();
  pinMode(17, OUTPUT);
  digitalWrite(17, HIGH);
  mcp.pinMode(BL, OUTPUT);
  mcp.digitalWrite(BL, HIGH);
  tft.initR(INITR_GREENTAB);
  tft.setRotation(1);
  tft.setTextWrap(true);
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);  //ST7735_BLACK ST7735_BLUE ST7735_RED ST7735_ORANGE ST7735_GREEN ST7735_CYAN ST7735_MAGENTA ST7735_YELLOW ST7735_WHITE
  tft.setCursor(0, 0);
  tft.setTextSize(1);
  tft.println("V 4.2");
  tft.println("Display eingerichtet");
  delay(500);
  pinMode(STEP1_PIN, OUTPUT);
  pinMode(DIR1_PIN, OUTPUT);
  pinMode(Endschalter, INPUT_PULLUP);
  pinMode(Zapfenbeenden, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(Zapfenbeenden), NotAus, FALLING);
  pinMode(STEP2_PIN, OUTPUT);
  //pinMode(DIR2_PIN, OUTPUT);
  driver.begin();            //  SPI: Init CS pins and possible SW SPI pins
  driver.toff(5);            // Enables driver in software
  driver.rms_current(2300);  // Set motor RMS current
  driver.microsteps(8);      // Set microsteps to 1/16th
  driver.en_pwm_mode(true);
  driver.shaft(true);
  driverb.begin();            //  SPI: Init CS pins and possible SW SPI pins
  driverb.toff(5);            // Enables driver in software
  driverb.rms_current(2300);  // Set motor RMS current
  driverb.microsteps(8);      // Set microsteps to 1/16th
  driverb.en_pwm_mode(true);
  driverb.shaft(0);
  tft.println("Stepper eingerichtet");

  /* Ist eine komplette Umdrehung
for (i = 12000; i >= 0; i--) {
      digitalWrite(STEP1_PIN, HIGH);
      delayMicroseconds(100);
      digitalWrite(STEP1_PIN, LOW);
      delayMicroseconds(100);
    }
*/

  /* Ist eine komplette Umdrehung
for (i = 4000; i >= 0; i--) {
      digitalWrite(STEP2_PIN, HIGH);
      delayMicroseconds(600);
      digitalWrite(STEP2_PIN, LOW);
      delayMicroseconds(600);
    }
*/

  mcp.pinMode(Entriegelung, OUTPUT);
  mcp.digitalWrite(Entriegelung, HIGH);
  while (digitalRead(Endschalter) == 0) {
    digitalWrite(STEP1_PIN, HIGH);
    delayMicroseconds(100);
    digitalWrite(STEP1_PIN, LOW);
    delayMicroseconds(100);
  }
  mcp.digitalWrite(Entriegelung, LOW);

  mcp.pinMode(Nullstellung, INPUT);
  AufNullStellen();
  delay(1000);
  //KranzPrufen();
  // Nachsteposition();


  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  myservoA.setPeriodHertz(50);  // standard 50 hz servo
  myservoB.setPeriodHertz(50);  // standard 50 hz servo

  myservoA.attach(PIN_SERVO1, 1000, 2000);
  myservoB.attach(PIN_SERVO2, 1000, 2000);

  myservoA.write(HahnNull);
  myservoB.write(KompensatorMin);




  //pinMode(Position, INPUT);
  //pinMode(Position2, INPUT);

  mcp.pinMode(Hoch, INPUT);
  mcp.pinMode(Runter, INPUT);
  mcp.pinMode(Links, INPUT);
  mcp.pinMode(Rechts, INPUT);
  mcp.pinMode(Enter, INPUT);


  tft.fillScreen(ST77XX_BLACK);

  mcp.pinMode(FassSchlauch, INPUT);
  if (mcp.digitalRead(FassSchlauch) == LOW) {
    DisplayGrundeinstellung();
  } else {
    DisplayAnzapfen();
  }

  sensors.begin();
  /*for (int i = 0; i < strip.numPixels(); i++) {     // For each pixel in strip...
    strip.setPixelColor(i, strip.Color(0, 30, 0));  //  Set pixel's color (in RAM)
  }
  strip.show();*/
}



void loop() {
  aktuelleZeit = millis();
  aktuelleMicros = micros();
  delay(100);
  if (letzteAktualisierung <= aktuelleZeit - displayAktualisierung) {
    letzteAktualisierung = aktuelleZeit;
    if (mcp.digitalRead(FassSchlauch) == LOW) {
      if (warvorher == 0) {
        DisplayGrundeinstellung();
        warvorher = 1;
      }
      DisplaySchreiben();
    }
    if (mcp.digitalRead(FassSchlauch) == HIGH && warvorher == 1) {
      DisplayAnzapfen();
      warvorher = 0;
    }
  }

  if (mcp.digitalRead(FassSchlauch) == LOW) {
    if (mcp.digitalRead(Runter) == 0) {
      menupunkt += 1;
      if (menupunkt >= 6)
        menupunkt = 1;
      DisplaySchreiben();
    }
    if (mcp.digitalRead(Hoch) == 0) {
      menupunkt -= 1;
      if (menupunkt <= 0)
        menupunkt = 5;
      DisplaySchreiben();
    }
    if (mcp.digitalRead(Rechts) == 0) {
      if (menupunkt == 1) {
        Durchflussrate += 1;
        if (Durchflussrate >= 11)
          Durchflussrate = 10;
      }
      if (menupunkt == 2) {
        schaumniveau += 1;
        if (schaumniveau >= 11)
          schaumniveau = 10;
      }
      if (menupunkt == 3) {
        fullhohe += 1;
        if (fullhohe >= 11)
          fullhohe = 10;
      }
      if (menupunkt == 4) {
        hochfahrGeschwindigkeit += 1;
        if (hochfahrGeschwindigkeit >= 11)
          hochfahrGeschwindigkeit = 10;
      }
      if (menupunkt == 5) {
        anzapfzeit += 1;
        if (anzapfzeit >= 11)
          anzapfzeit = 10;
      }
      EEPROM.write(0, Durchflussrate);
      EEPROM.write(1, schaumniveau);
      EEPROM.write(2, fullhohe);
      EEPROM.write(3, hochfahrGeschwindigkeit);
      EEPROM.write(4, anzapfzeit);
      EEPROM.commit();
      DisplaySchreiben();
    }
    if (mcp.digitalRead(Links) == 0) {
      if (menupunkt == 1) {
        Durchflussrate -= 1;
        if (Durchflussrate <= 1)
          Durchflussrate = 1;
      }
      if (menupunkt == 2) {
        schaumniveau -= 1;
        if (schaumniveau <= 1)
          schaumniveau = 1;
      }
      if (menupunkt == 3) {
        fullhohe -= 1;
        if (fullhohe <= 1)
          fullhohe = 1;
      }
      if (menupunkt == 4) {
        hochfahrGeschwindigkeit -= 1;
        if (hochfahrGeschwindigkeit <= 1)
          hochfahrGeschwindigkeit = 1;
      }
      if (menupunkt == 5) {
        anzapfzeit -= 1;
        if (anzapfzeit <= 1)
          anzapfzeit = 1;
      }
      EEPROM.write(0, Durchflussrate);
      EEPROM.write(1, schaumniveau);
      EEPROM.write(2, fullhohe);
      EEPROM.write(3, hochfahrGeschwindigkeit);
      EEPROM.write(4, anzapfzeit);
      EEPROM.commit();
      DisplaySchreiben();
    }
  } else {
    while (mcp.digitalRead(Zapfenstarten) == 0) {
      myservoA.write(HahnVor);
    }
    myservoA.write(HahnNull);
    if (mcp.digitalRead(FassSchlauch) == LOW) {
      DisplayGrundeinstellung();
    }
  }
  //##Prüfen, ob Taster gedrückt                       ########       Prüfen, ob ein Glas da ist (Analogwert muss zwischen 2 Werten sein)          ########             Prüfen, ob ein Glas voll ist (Analogwert muss zwischen 2 Werten sein)
  //if (digitalRead(Enter) == HIGH && zapfvorgangAktiv == 0 && IstGlasDa() == 1 && IstGlasVoll() == 0) {
  if (mcp.digitalRead(Zapfenstarten) == 0 && zapfvorgangAktiv == 0) {
    zapfvorgangGestartet = 1;
  }
  //If(KranzPrufen()
  if (zapfvorgangGestartet == 1) {
    /*for (int i = 0; i < strip.numPixels(); i++) {     // For each pixel in strip...
      strip.setPixelColor(i, strip.Color(30, 0, 0));  //  Set pixel's color (in RAM)
    }
    strip.show();*/
    if (KranzPrufen() == 0) {
      /*for (int z = 0; z < 3; z++) {
        for (int i = 0; i < strip.numPixels(); i++) {    // For each pixel in strip...
          strip.setPixelColor(i, strip.Color(30, 0, 0));  //  Set pixel's color (in RAM)
        }
        strip.show();
        delay(200);
        for (int i = 0; i < strip.numPixels(); i++) {     // For each pixel in strip...
          strip.setPixelColor(i, strip.Color(0, 0, 0));  //  Set pixel's color (in RAM)
        }
        strip.show();
        delay(200);
      }*/
      for (i = 500; i >= 0; i--) {
        digitalWrite(STEP2_PIN, HIGH);
        delayMicroseconds(500);
        digitalWrite(STEP2_PIN, LOW);
        delayMicroseconds(500);
      }
      AufNullStellen();
      zapfvorgangGestartet = 0;
    } else {
      for (bieregezapft = 1; bieregezapft <= 6; bieregezapft++) {
        if (analogRead(IRA) >= 1500 && mcp.digitalRead(FassSchlauch) == LOW) {
          BierZapfen();
        }
        Nachsteposition();
      }
      fehler = 0;
      zapfvorgangAktiv = 0;
      zapfvorgangGestartet = 0;
      AufNullStellen();
    }
  }
  /*for (int i = 0; i < strip.numPixels(); i++) {     // For each pixel in strip...
    strip.setPixelColor(i, strip.Color(0, 30, 0));  //  Set pixel's color (in RAM)
  }
  strip.show();*/
}


void TextKlaren(int hor, int vert, int lange, int grosse) {
  tft.fillRect(hor, vert, (lange * grosse * 6) - grosse, grosse * 7, ST77XX_BLACK);
}

void DisplaySchreiben() {

  tft.setTextSize(2);

  TextKlaren(96, 0, 2, 2);
  tft.setCursor(96, 0);
  tft.println(Durchflussrate);

  TextKlaren(108, 16, 2, 2);
  tft.setCursor(108, 16);
  tft.println(schaumniveau);

  TextKlaren(84, 32, 2, 2);
  tft.setCursor(84, 32);
  tft.print(fullhohe);

  TextKlaren(108, 48, 2, 2);
  tft.setCursor(108, 48);
  tft.println(hochfahrGeschwindigkeit);

  TextKlaren(96, 64, 2, 2);
  tft.setCursor(96, 64);
  tft.println(anzapfzeit);

  TextKlaren(13, 80, 8, 2);
  tft.setCursor(13, 80);
  tft.print(mcp.digitalRead(Reed));
  tft.print(" ");
  tft.print(mcp.digitalRead(Reed2));
  tft.print(" ");
  tft.print(analogRead(IRA));

  tft.fillRect(0, 0, 12, 95, ST77XX_BLACK);

  switch (menupunkt) {

    case 1:

      tft.setCursor(0, 0);
      tft.print(">");
      break;

    case 2:

      tft.setCursor(0, 16);
      tft.print(">");

      break;

    case 3:

      tft.setCursor(0, 32);
      tft.print(">");

      break;

    case 4:

      tft.setCursor(0, 48);
      tft.print(">");

      break;

    case 5:

      tft.setCursor(0, 64);
      tft.print(">");

      break;

    default:

      // Statement(s)

      break;  // Wird nicht benötigt, wenn Statement(s) vorhanden sind
  }
  sensors.requestTemperatures();
  float temperatureC = sensors.getTempCByIndex(0);
  TextKlaren(0, 96, 8, 2);
  tft.setCursor(0, 96);
  tft.print(temperatureC);
  tft.print("C");
}


bool IstGlasDa() {
  if (analogRead(IRA) <= GlasDa + GlasDaToleranz && analogRead(IRA) >= GlasDa - GlasDaToleranz) {
    return 1;
  } else {
    return 0;
  }
}

bool IstGlasVoll() {
  if (analogRead(IRA) <= GlasVoll + GlasVollToleranz && analogRead(IRA) >= GlasVoll - GlasVollToleranz) {
    return 1;
  } else {
    return 0;
  }
}



void AufNullStellen() {

  while (mcp.digitalRead(Nullstellung) == 1) {
    digitalWrite(STEP2_PIN, HIGH);
    delayMicroseconds(500);
    digitalWrite(STEP2_PIN, LOW);
    delayMicroseconds(500);
  }

  zz = mcp.digitalRead(Nullstellung);
}


bool KranzPrufen() {
  Steps = 0;
  while (Steps <= StepsBisNull) {
    reedalesen = mcp.digitalRead(Reed);
    reedblesen = mcp.digitalRead(Reed2);
    if (reedalesen == 0 || reedblesen == 0) {
      Steps = StepsBisNull + 1;
    } else {
      Steps += 1;
    }
    digitalWrite(STEP2_PIN, HIGH);
    delayMicroseconds(500);
    digitalWrite(STEP2_PIN, LOW);
    delayMicroseconds(500);
    //Serial.println(Steps);
  }
  if (reedalesen == 0 || reedblesen == 0) {
    return 1;
  } else {
    return 0;
  }
}

void BierZapfen() {
  zapfvorgangGestartet = 1;
  myservoB.write(map(Durchflussrate, 10, 0, KompensatorMax, KompensatorMin));

  mcp.digitalWrite(Entriegelung, HIGH);    // Schlitten Freigeben
  driver.shaft(false);                     //Richtung nach unten
  for (i = Anfangssenkung; i >= 0; i--) {  // Schlitten etwas nach unten fahren
    digitalWrite(STEP1_PIN, HIGH);
    delayMicroseconds(map(runterfahrGeschwindigkeit, 0, 10, Vsmax, Vsmin));
    digitalWrite(STEP1_PIN, LOW);
    delayMicroseconds(map(runterfahrGeschwindigkeit, 0, 10, Vsmax, Vsmin));
  }
  mcp.digitalWrite(Entriegelung, LOW);               // Schlitten an freigabe vorbei und nicht mehr Freigeben
  for (i = Schritte * Schrittfaktor; i >= 0; i--) {  // Schlitten zum Glasboden bringen
    digitalWrite(STEP1_PIN, HIGH);
    delayMicroseconds(map(runterfahrGeschwindigkeit, 0, 10, Vsmax, Vsmin));
    digitalWrite(STEP1_PIN, LOW);
    delayMicroseconds(map(runterfahrGeschwindigkeit, 0, 10, Vsmax, Vsmin));
  }
  z = 0;
  driver.shaft(true);  //Richtung nach oben
  fullhohezapfen = fullhohe * Schrittfaktor;
  if (mcp.digitalRead(Reed2) == 0) {
    fullhohezapfen = (fullhohe * Schrittfaktor) / 2;
  }
  zapfvorgangAktiv = 1;
  myservoA.write(HahnVor);
  delay(anzapfzeit * 300);

  mcp.digitalWrite(Entriegelung, HIGH);
  while (zapfvorgangAktiv == 1 && z <= fullhohezapfen) {
    digitalWrite(STEP1_PIN, HIGH);
    delayMicroseconds(map(hochfahrGeschwindigkeit, 0, 10, Vsmax, Vsmin));
    digitalWrite(STEP1_PIN, LOW);
    delayMicroseconds(map(hochfahrGeschwindigkeit, 0, 10, Vsmax, Vsmin));
    z += 1;
    /*if (IstGlasVoll() == 1 && z <= fullhohe * 1000 / 2) {
        z = fullhohe * 1000;
        fehler = 1;
        myservoA.write(HahnNull);
      }*/
  }

  myservoA.write(HahnZuruck);
  delay(schaumniveau * 500);
  myservoA.write(HahnNull);
  while (digitalRead(Endschalter) == 0) {
    digitalWrite(STEP1_PIN, HIGH);
    delayMicroseconds(Vsmin * 2);
    digitalWrite(STEP1_PIN, LOW);
    delayMicroseconds(Vsmin * 2);
  }
  mcp.digitalWrite(Entriegelung, LOW);
  delay(500);
  zapfvorgangAktiv = 0;
  myservoB.write(KompensatorMin);
}

bool GlasPrufen() {
  bool GlasWarMalDa = 0;
  for (i = 0; i <= 100; i++) {
    if (analogRead(IRA) >= GlasDa)
      GlasWarMalDa = 1;
    delay(3);
  }
  if (GlasWarMalDa == 1) {
    return 1;
  } else {
    return 0;
  }
}

void Nachsteposition() {
  Serial.println("Nachsteposition");
  int minimalgeschwindigkeit = 1000;
  int FunfsechstelUmdrehung = 800;
  for (i = 0; i <= FunfsechstelUmdrehung; i++) {

    int rampschritte = 200;
    int rampfaktor = 2;

    digitalWrite(STEP2_PIN, HIGH);
    if (i >= (FunfsechstelUmdrehung - rampschritte)) {  //i größer als wert
      delayMicroseconds((minimalgeschwindigkeit * rampfaktor) - ((FunfsechstelUmdrehung - i) * 8));
      Serial.print("C ");
      Serial.println((minimalgeschwindigkeit * rampfaktor) - ((FunfsechstelUmdrehung - i) * 8));
    } else if (i <= rampschritte) {  // dieser Wert <= i  < oberer wert
      delayMicroseconds((minimalgeschwindigkeit * rampfaktor) - (i * 8));
      Serial.print("A ");
      Serial.println((minimalgeschwindigkeit * rampfaktor) - (i * 8));
    } else {  // i < mittlerer wert
      delayMicroseconds(rampschritte * 2);
      Serial.print("B ");
      Serial.println(rampschritte * 2);
    }
    digitalWrite(STEP2_PIN, LOW);
    if (i >= (FunfsechstelUmdrehung - rampschritte)) {  //i größer als wert
      delayMicroseconds((minimalgeschwindigkeit * rampfaktor) - ((FunfsechstelUmdrehung - i) * 8));
    } else if (i <= rampschritte) {  // dieser Wert <= i  < oberer wert
      delayMicroseconds((minimalgeschwindigkeit * rampfaktor) - (i * 8));
    } else {  // i < mittlerer wert
      delayMicroseconds(rampschritte * 2);
    }
  }
}


void RunterFahren(int fahrschritte, int fahrgeschwindigkeit) {
}

void HochFahren(int fahrschritte, int fahrgeschwindigkeit) {
}


void DisplayGrundeinstellung() {
  tft.fillScreen(ST77XX_BLACK);
  tft.setCursor(0, 0);
  tft.setTextSize(2);
  tft.println(" Fluss: ");
  tft.println(" Schaum: ");
  tft.println(" Glas: ");
  tft.println(" Steig.: ");
  tft.println(" Pause: ");
  DisplaySchreiben();
}
void DisplayAnzapfen() {
  tft.fillScreen(ST77XX_BLACK);
  tft.setCursor(0, 0);
  tft.setTextSize(2);
  tft.println("Fass Leer");
  tft.println("Anzapfen!");
}

void NotAus() {
  myservoA.write(HahnNull);
  myservoB.write(KompensatorMin);
  fehler = 1;
  zapfvorgangGestartet = 0;
  zapfvorgangAktiv = 0;
  while (digitalRead(Endschalter) == 0) {
    digitalWrite(STEP1_PIN, HIGH);
    delayMicroseconds(100);
    digitalWrite(STEP1_PIN, LOW);
    delayMicroseconds(100);
  }
  AufNullStellen();
}




//Erklärung                 230