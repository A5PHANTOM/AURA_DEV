// Shared ESP32 configuration for frontend
// Rover board (sensors, status, movement, patrol)
export const ESP32_ROVER_API = "http://192.168.1.11";

// ESP32-CAM board (camera snapshots for live view / face recognition)
export const ESP32_CAM_API = "http://192.168.1.4";

// MUST match GAS_THRESHOLD in the rover ESP32 sketch.
export const GAS_THRESHOLD = 1500;
