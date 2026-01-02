// Shared ESP32 configuration for frontend
export const ESP32_API = "http://192.168.216.32";
// Higher threshold so "HIGH" gas alerts are less sensitive.
// MUST match GAS_THRESHOLD in the ESP32 sketch.
export const GAS_THRESHOLD = 2500;
