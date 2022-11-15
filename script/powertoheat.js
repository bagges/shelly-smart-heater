let heating = false;
let tempBoiler = 0;
let tempPuffer = 0;
let heatingCounter = 0;
let currentSwitchesOn = 0;
let smartMeterValueReceived = false;

let mqttTopic = "tele/smartmeter/SENSOR";
let mqttTopicBoilerTemp = "sensor/boilertemperatur_oben";
let mqttTopicPufferTemp = "sensor/puffertemperatur_oben";


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
  if(tempPuffer < 63 && tempBoiler <= 68) {
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
  let messageObject = JSON.parse(message);
  print("received power from smartmeter. Current power: ", messageObject.SML.Power_curr);
  smartMeterValueReceived = true;

  if(messageObject.SML.Power_curr < -1500) {
    if(heatingCounter < 3 && currentSwitchesOn !== 3) {
      heatingCounter++;
    }
  }

  if(messageObject.SML.Power_curr > -400) {
    if(heatingCounter > -3) {
      heatingCounter--;
    }
  }
  
  print("current heating counter: ", heatingCounter);
  loop();
}

function processMqttBoilerTemp(topic, message, callbackarg) {
  print("received boiler temp: ", message);
  tempBoiler = JSON.parse(message);
}

function processMqttPufferTemp(topic, message, callbackarg) {
  print("received puffer temp: ", message);
  tempPuffer = JSON.parse(message);
}

function switchPhase(index, turnOn){
  Shelly.call(
    "Switch.Set",
     { id:index, on:turnOn },
     function(result) {
     })
}

function turnOff() {
  switchPhase(0, false);
  switchPhase(1, false);
  switchPhase(2, false);
  currentSwitchesOn = 0;
}

function smartMeterHealthCheck(userdata){
  if(smartMeterValueReceived) {
    print("smartmeter healthy");
    smartMeterValueReceived = false;
  } else {
    print("smartmeter unhealthy");
    turnOffAndDie();

  }
}

function turnOffAndDie(){
    turnOff();
    die("byebye");
}

MQTT.subscribe(mqttTopic, processMqtt);
MQTT.subscribe(mqttTopicBoilerTemp, processMqttBoilerTemp);
MQTT.subscribe(mqttTopicPufferTemp, processMqttPufferTemp);
Timer.set(300000, true, smartMeterHealthCheck); //five minutes