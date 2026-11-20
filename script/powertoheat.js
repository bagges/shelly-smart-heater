// ---- configuration ----
let maxTemp = 72;                    // stop heating at or above this temperature
let minTemp = 69;                    // start heating at or below this temperature
let powerUpThreshold = -1250;        // grid power (W) at or below which a phase may be added
let powerDownThreshold = 50;         // power (W) at or above which a phase is removed
let batteryTargetSoc = 70.0;
let switchCount = 3;
let relayTimeoutSec = 900;           // hardware auto-off: relays turn off by themselves if the script stops refreshing them
let tempPlausibleMin = 1;            // readings outside this range are treated as sensor errors and ignored
let tempPlausibleMax = 110;
let tempMaxAgeMs = 10 * 60 * 1000;   // HA publishes every 3 min; older values are considered stale
let healthCheckIntervalMs = 300000;  // five minutes

let mqttTopic = "sensor/power_curr";
let mqttTopicBoilerTemp = "sensor/boilertemperatur_oben";
let mqttTopicPufferTemp = "sensor/puffertemperatur_oben";
let mqttTopicBatteryOutput = "sensor/battery_output_power";
let mqttTopicBatterySoC = "sensor/battery_soc";

// ---- state ----
let heating = false;
let tempBoiler = 0;
let tempPuffer = 0;
let tempBoilerAt = -1;               // uptime (ms) of last boiler value, -1 = never received
let tempPufferAt = -1;
let currentPower = 0;
let batteryOutput = 0;
let batterySoC = 0.0;
let heatingCounter = 0;
let currentSwitchesOn = 0;
let smartMeterValueReceived = false;

// state for the switch status sync (mJS has no closures, so this lives in globals)
let syncRunning = false;
let syncIndex = 0;
let syncCount = 0;

function switchPhase(index, turnOn) {
  if (turnOn) {
    // toggle_after makes the Shelly firmware switch the relay off again if we crash or lose contact
    Shelly.call("Switch.Set", { id: index, on: true, toggle_after: relayTimeoutSec }, onSwitchSet);
  } else {
    Shelly.call("Switch.Set", { id: index, on: false }, onSwitchSet);
  }
}

function onSwitchSet(result, errorCode, errorMessage, userData) {
  if (errorCode !== 0) {
    print("Switch.Set failed: ", errorCode, " ", errorMessage);
  }
}

function turnOff() {
  for (let i = 0; i < switchCount; i++) {
    switchPhase(i, false);
  }
  currentSwitchesOn = 0;
}

function increasePhases() {
  if (currentSwitchesOn < switchCount) {
    print("turning on switch", currentSwitchesOn);
    switchPhase(currentSwitchesOn, true);
    currentSwitchesOn++;
    heatingCounter = 0;
  }
}

function decreasePhases() {
  if (currentSwitchesOn > 0) {
    currentSwitchesOn--;
    print("turning off switch", currentSwitchesOn);
    switchPhase(currentSwitchesOn, false);
    if (currentSwitchesOn === 0) {
      heatingCounter = 0;
    }
  }
}

// Stops heating and resets the counter. Only sends RPC calls if something is on, unless forced.
function stopHeating(force) {
  if (heating || currentSwitchesOn > 0 || force) {
    print("stop heating...");
    turnOff();
  }
  heating = false;
  heatingCounter = 0;
}

// Home Assistant republishes every 3 minutes, so a value older than tempMaxAgeMs means the sensor
// or the publishing automation is down (an 'unavailable' payload is ignored and ages the same way).
function tempsValid() {
  if (tempBoilerAt < 0 || tempPufferAt < 0) {
    return false;
  }
  let now = Shelly.getUptimeMs();
  return (now - tempBoilerAt) <= tempMaxAgeMs && (now - tempPufferAt) <= tempMaxAgeMs;
}

function maxTempReached() {
  return tempBoiler >= maxTemp || tempPuffer >= maxTemp;
}

function minTempReached() {
  return tempPuffer <= minTemp && tempBoiler <= minTemp;
}

function loop() {
  if (!tempsValid()) {
    print("temperatures missing or stale");
    stopHeating(false);
    return;
  }
  if (maxTempReached()) {
    print("max temp reached");
    stopHeating(false);
    return;
  }

  // start heating when both temperatures fall below the configured minimum
  if (minTempReached()) {
    print("min temp reached");
    heating = true;
  }

  print("heating: ", heating);
  if (heating) {
    if (heatingCounter === 3 && currentSwitchesOn !== switchCount) {
      increasePhases();
    }
    if (heatingCounter === -3 && currentSwitchesOn !== 0) {
      decreasePhases();
    }
  }
}

// Home Assistant may publish 'unavailable'/'unknown'. mJS has no try/catch, so validate
// strictly before JSON.parse: optional '-', digits (no leading zeros), optional '.digits'.
function isNumeric(message) {
  if (message === null || message === undefined) {
    return false;
  }
  let s = "" + message;
  let n = s.length;
  let i = 0;
  if (n > 0 && s.charCodeAt(0) === 45) { // '-'
    i = 1;
  }
  let digits = 0;
  let dots = 0;
  let firstDigit = -1;
  while (i < n) {
    let c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) { // '0'..'9'
      if (digits === 1 && firstDigit === 48 && dots === 0) {
        return false; // leading zero, e.g. "007"
      }
      if (digits === 0) {
        firstDigit = c;
      }
      digits++;
    } else if (c === 46 && dots === 0 && digits > 0) { // '.'
      dots++;
      digits = 2; // integer part finished; relax the leading zero check
      firstDigit = -1;
    } else {
      return false;
    }
    i++;
  }
  return digits > 0 && s.charCodeAt(n - 1) !== 46;
}

function processMqtt(topic, message, callbackarg) {
  if (!isNumeric(message)) {
    return;
  }

  currentPower = JSON.parse(message);
  print("received power from smartmeter. Current power: ", currentPower);
  smartMeterValueReceived = true;

  let wantUp = currentPower <= powerUpThreshold ||
    (batteryOutput <= powerUpThreshold && batterySoC >= batteryTargetSoc);
  let wantDown = currentPower >= powerDownThreshold || batteryOutput >= powerDownThreshold;

  // conflicting signals cancel each other out
  if (wantUp && !wantDown) {
    if (heatingCounter < 3 && currentSwitchesOn !== switchCount) {
      heatingCounter++;
    }
  } else if (wantDown && !wantUp) {
    if (heatingCounter > -3) {
      heatingCounter--;
    }
  }

  print("current heating counter: ", heatingCounter);
  loop();
}

function plausibleTemp(value) {
  return value >= tempPlausibleMin && value <= tempPlausibleMax;
}

function processMqttBoilerTemp(topic, message, callbackarg) {
  if (!isNumeric(message)) {
    return;
  }
  print("received boiler temp: ", message);
  let value = JSON.parse(message);
  if (!plausibleTemp(value)) {
    print("implausible boiler temp ignored");
    return;
  }
  tempBoiler = value;
  tempBoilerAt = Shelly.getUptimeMs();
  loop(); // react immediately to max temp
}

function processMqttPufferTemp(topic, message, callbackarg) {
  if (!isNumeric(message)) {
    return;
  }
  print("received puffer temp: ", message);
  let value = JSON.parse(message);
  if (!plausibleTemp(value)) {
    print("implausible puffer temp ignored");
    return;
  }
  tempPuffer = value;
  tempPufferAt = Shelly.getUptimeMs();
  loop(); // react immediately to max temp
}

function processMqttBatteryOutput(topic, message, callbackarg) {
  if (!isNumeric(message)) {
    return;
  }
  print("received battery output: ", message);
  batteryOutput = JSON.parse(message);
}

function processMqttBatterySoC(topic, message, callbackarg) {
  if (!isNumeric(message)) {
    return;
  }
  print("received battery soc: ", message);
  batterySoC = JSON.parse(message);
}

// ---- compare the real relay state with currentSwitchesOn ----
function syncSwitches() {
  if (syncRunning) {
    return;
  }
  syncRunning = true;
  syncIndex = 0;
  syncCount = 0;
  querySwitch();
}

function querySwitch() {
  Shelly.call("Switch.GetStatus", { id: syncIndex }, onSwitchStatus);
}

function onSwitchStatus(result, errorCode, errorMessage, userData) {
  if (errorCode !== 0 || result === null || result === undefined) {
    print("Switch.GetStatus failed: ", errorCode, " ", errorMessage);
    syncRunning = false;
    return;
  }
  if (result.output) {
    syncCount++;
  }
  syncIndex++;
  if (syncIndex < switchCount) {
    querySwitch();
    return;
  }
  syncRunning = false;
  if (syncCount !== currentSwitchesOn) {
    print("switch state mismatch, real: ", syncCount, " expected: ", currentSwitchesOn);
    stopHeating(true);
  }
}

// re-arm the hardware auto-off timer of every relay that should be on
function refreshRelayTimers() {
  for (let i = 0; i < currentSwitchesOn; i++) {
    switchPhase(i, true);
  }
}

function healthCheck(userdata) {
  if (smartMeterValueReceived) {
    print("smartmeter healthy");
    smartMeterValueReceived = false;
  } else {
    // keep running so we recover when the meter comes back
    print("smartmeter unhealthy");
    stopHeating(true);
    return;
  }

  if (!tempsValid()) {
    print("temperatures missing or stale");
    stopHeating(true);
    return;
  }
  refreshRelayTimers();
  syncSwitches();
}

// make sure nothing is left on from before a script restart
turnOff();

MQTT.subscribe(mqttTopic, processMqtt);
MQTT.subscribe(mqttTopicBoilerTemp, processMqttBoilerTemp);
MQTT.subscribe(mqttTopicPufferTemp, processMqttPufferTemp);
MQTT.subscribe(mqttTopicBatteryOutput, processMqttBatteryOutput);
MQTT.subscribe(mqttTopicBatterySoC, processMqttBatterySoC);
Timer.set(healthCheckIntervalMs, true, healthCheck);
