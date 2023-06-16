# !!!! This project ist still WIP. Heating rods use high voltage and temperatures. Use the content of this repository at your own risk !!!!

# shelly-smart-heater
Heating your water with a shelly, heating rod and solar power

## BOM
- Shelly 4PM Pro
- Shelly 1 PM Plus + Add-On
- 230V Relais 63A
- DS18B20 Sensors
- Askoma 3KW Heating Rod

## Wiring
Shelly 1 switches the relais which then powers the Shelly 4PM Pro. The Shelly 1 PM Plus monitors the temperatures and turns of if temperatures exceed a critical value. This helps to prevent overheating because of software issues with the script running on the Shelly 4PM Pro.

## Code
The code receives the temperature values from the heating system, solar power and battery output power. Based on this values the script turns on switches 1-3. If no values received within 300s heating is stopped.
