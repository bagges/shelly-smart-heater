let heating = false;
let tempBoiler = 72;
let tempPuffer = 72;
let batteryOutput = 0;
let batterySoC = 0.0;
let heatingCounter = 0;
let currentSwitchesOn = 0;
let smartMeterValueReceived = false;
let batteryTargetSoc = 100.0;

let mqttTopic = "sensor/power_curr";
let mqttTopicBoilerTemp = "sensor/boilertemperatur_oben";
let mqttTopicPufferTemp = "sensor/puffertemperatur_oben";
let mqttTopicBatteryOutput = "sensor/battery_output_power";
let mqttTopicBatterySoC = "sensor/battery_soc";

function increasePhases() {
  if(currentSwitchesOn < 3) {
    print("turning on switch", currentSwitchesOn );
    switchPhase(currentSwitchesOn , true);
    currentSwitchesOn++;
    heatingCounter = 0;
  }
}

function decreasePhases() {
  if(currentSwitchesOn >= 0) {
    print("turning off switch", currentSwitchesOn );
    currentSwitchesOn--;
    switchPhase(currentSwitchesOn , false);
  }
}

function stopHeating() {
  print("stop heating...");
  heating = false;
  turnOff();
}

function maxTempReached() {
  if(tempBoiler >= 72 || tempPuffer >= 72) {
    print("max temp reached");
    return true;
  }
  return false;
}

function minTempReached() {
  if(tempPuffer <= 69 && tempBoiler <= 69) {
    print("min temp reached");
    return true;
  }
  return false;
}

function loop() {
  if(maxTempReached()) {
    stopHeating();
  }
  
  print("heating: ", heating);
  //start heating when tempPuffer falls below configured temp
  if((minTempReached() && !maxTempReached()) || heating) {
    heating = true;
    if(heatingCounter === 3 && currentSwitchesOn !== 3) {
      increasePhases();
    }
    if(heatingCounter === -3 && currentSwitchesOn !== 0) {
      decreasePhases();
    }
  }
}

function processMqtt(topic, message, callbackarg) {
  if(message === null || message === '' || message === 'unavailable') {
    return;
  }
  
  print("received current power: ", message);
  currentPower = JSON.parse(message);
  
  print("received power from smartmeter. Current power: ", currentPower );
  smartMeterValueReceived = true;

  if(currentPower  <= -1250 || (batteryOutput <= -1250 && batterySoC >= batteryTargetSoc)) {
    if(heatingCounter < 3 && currentSwitchesOn !== 3) {
      heatingCounter++;
    }
  }

  if(currentPower  >= 50 || batteryOutput >= 50) {
    if(heatingCounter > -3) {
      heatingCounter--;
    }
  }
  
  print("current heating counter: ", heatingCounter);
  loop();
}

function processMqttBoilerTemp(topic, message, callbackarg) {
  if(message === null || message === '') {
    return;
  }
  print("received boiler temp: ", message);
  tempBoiler = JSON.parse(message);
}

function processMqttPufferTemp(topic, message, callbackarg) {
  if(message === null || message === '') {
    return;
  }
  print("received puffer temp: ", message);
  tempPuffer = JSON.parse(message);
}

function processMqttBatteryOutput(topic, message, callbackarg) {
  if(message === null || message === '') {
    return;
  }
  print("received battery output: ", message);
  batteryOutput = JSON.parse(message);
}

function processMqttBatterySoC(topic, message, callbackarg) {
  if(message === null || message === '') {
    return;
  }
  print("received battery soc: ", message);
  batterySoC = JSON.parse(message);
}


function switchPhase(index, turnOn){
  Shelly.call(
    "Switch.Set",
     { id:index, on:turnOn });
}

function turnOff() {
  switchPhase(0, false);
  switchPhase(1, false);
  switchPhase(2, false);
  currentSwitchesOn = 0;
}


//function getSwitchesOn() {
//  let switchesOn = 0;
//
//  Shelly.call(
//    "Switch.getStatus",
//    { id:0 },
//    function (result, error_code, error_message, user_data) {
//      if(result.output) { 
//        switchesOn++;
//      }
//    });

//  Shelly.call(
//    "Switch.getStatus",
//    { id:1 },
//    function (result, error_code, error_message, user_data) {
//      if(result.output) { 
//        switchesOn++;
//      }
//    });

//  print("current switches on: " + switchesOn);
//  return switchesOn;
//}

function smartMeterHealthCheck(userdata){
  if(smartMeterValueReceived) {
    print("smartmeter healthy");
    smartMeterValueReceived = false;
  } else {
    print("smartmeter unhealthy");
    turnOffAndDie();
  }
//  if(currentSwitchesOn !== getSwitchesOn()) {
//    print("currentSwitchesOn !== getSwitchesOn()");
//    turnOffAndDie();
//  }
}

function turnOffAndDie(){
    turnOff();
    die("byebye");
}

MQTT.subscribe(mqttTopic, processMqtt);
MQTT.subscribe(mqttTopicBoilerTemp, processMqttBoilerTemp);
MQTT.subscribe(mqttTopicPufferTemp, processMqttPufferTemp);
MQTT.subscribe(mqttTopicBatteryOutput , processMqttBatteryOutput);
MQTT.subscribe(mqttTopicBatterySoC , processMqttBatterySoC);
Timer.set(300000, true, smartMeterHealthCheck); //five minutes
