import React, { useEffect, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { ESP32_CAM_API } from "../services/espConfig";
import { runFaceRecognition } from "../services/faceService";

const auraFontStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&display=swap');
  .font-aura { font-family: 'Orbitron', sans-serif; letter-spacing: 0.12em; }
`;

function Dashboard() {
  const [cameraFrameUrl, setCameraFrameUrl] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [detections, setDetections] = useState([]);
  const [frameSize, setFrameSize] = useState({ width: null, height: null });
  const lastRecognitionAtRef = useRef(0);
  const recognitionInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const fetchFrame = async () => {
      try {
        const res = await fetch(`${ESP32_CAM_API}/capture`);
        if (!res.ok) throw new Error("ESP32 capture failed");
        const blob = await res.blob();
        if (!blob || cancelled) return;

        const url = URL.createObjectURL(blob);
        setCameraFrameUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
        setCameraError("");

        // one-time measurement of frame dimensions for overlay scaling
        if (!frameSize.width || !frameSize.height) {
          const img = new Image();
          img.onload = () => {
            setFrameSize({ width: img.naturalWidth, height: img.naturalHeight });
          };
          img.src = url;
        }

        // periodically run face recognition on the live feed
        const now = Date.now();
        const MIN_INTERVAL_MS = 2500;
        if (
          !recognitionInFlightRef.current &&
          now - lastRecognitionAtRef.current >= MIN_INTERVAL_MS
        ) {
          lastRecognitionAtRef.current = now;
          recognitionInFlightRef.current = true;
          const file = new File([blob], "frame.jpg", { type: blob.type || "image/jpeg" });
          runFaceRecognition(file)
            .then((data) => {
              setDetections(data.detections || []);
            })
            .catch(() => {
              // ignore recognition errors
            })
            .finally(() => {
              recognitionInFlightRef.current = false;
            });
        }
      } catch (e) {
        if (!cancelled) {
          setCameraError("ESP32-CAM not reachable");
        }
      }
    };

    // initial frame
    fetchFrame();
    // poll every second for a simple live view
    const id = setInterval(fetchFrame, 1000);

    return () => {
      cancelled = true;
      clearInterval(id);
      setCameraFrameUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      setDetections([]);
    };
  }, []);

  return (
  <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <style>{auraFontStyles}</style>
      <Starfield />

      {/* NAVBAR (rendered outside the glass panel so it spans full width) */}
      <Navbar />

      <div className="w-full max-w-6xl bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-2xl space-y-6 z-10 border border-white/10">

        {/* GRID LAYOUT */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

        {/* LEFT PANEL */}
        <div className="bg-[#081423] p-4 rounded-lg shadow-lg space-y-4">
          <h2 className="text-cyan-400 font-semibold">System Status</h2>

          <Status label="Battery" value="84%" />
          <Status label="Network" value="Connected" />
          <Status label="Mode" value="Autonomous" />
          <Status label="Face Detection" value="Enabled" />
          <Status label="Bluetooth" value="Ready" />
        </div>

        {/* CENTER CAMERA */}
        <div className="col-span-1 md:col-span-2 bg-[#081423] rounded-lg p-4 shadow-lg flex flex-col justify-between">
          <h2 className="text-cyan-400 font-semibold mb-2">Live Camera</h2>
          <div className="flex-1 flex items-center justify-center border border-cyan-500 rounded-lg bg-black/60">
            {cameraFrameUrl ? (
              <div className="relative">
                <img
                  src={cameraFrameUrl}
                  alt="ESP32 live view"
                  className="max-h-64 rounded-md object-contain"
                />
                {frameSize.width && frameSize.height && detections.map((d, idx) => {
                  const bbox = d.bbox || [];
                  if (bbox.length !== 4) return null;
                  const [x1, y1, x2, y2] = bbox;
                  const left = (x1 / frameSize.width) * 100;
                  const top = (y1 / frameSize.height) * 100;
                  const width = ((x2 - x1) / frameSize.width) * 100;
                  const height = ((y2 - y1) / frameSize.height) * 100;
                  const isUnknown = !d.person_name || d.person_name === "Unknown";
                  const borderColor = isUnknown ? "border-red-500" : "border-emerald-400";
                  const bgColor = isUnknown ? "bg-red-500" : "bg-emerald-500";
                  const showScore = typeof d.match_score === "number" && d.match_score >= 0.2;
                  const scoreLabel = showScore ? ` (${(d.match_score * 100).toFixed(1)}%)` : "";
                  return (
                    <div
                      key={idx}
                      className={`absolute border-2 ${borderColor} pointer-events-none`}
                      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                    >
                      <div
                        className={`absolute left-0 -top-5 px-1 py-0.5 text-[10px] font-semibold text-white rounded ${bgColor}`}
                      >
                        {isUnknown ? "Unknown" : d.person_name}
                        {scoreLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-gray-400 text-sm">CAMERA STREAM OFFLINE</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {cameraError || `ESP32-CAM at ${ESP32_CAM_API}`}
          </p>
        </div>

        {/* RIGHT SENSOR PANEL */}
        <div className="bg-[#081423] p-4 rounded-lg shadow-lg">
          <h2 className="text-cyan-400 font-semibold mb-4">Sensors</h2>
          <Sensor label="IR Sensor" status="Active" />
          <Sensor label="Ultrasonic" status="Detecting" />
          <Sensor label="Mic" status="Listening" />
          <Sensor label="Temp" status="34°C" />
          <Sensor label="Storage" status="72% Used" />
        </div>
      </div>

      {/* LOG SECTION */}
      <div className="mt-6 bg-black rounded-lg p-4 text-green-400 font-mono text-sm h-40 overflow-y-auto">
        <p>[SYSTEM] Initialization complete</p>
        <p>[AI] Face detection enabled</p>
        <p>[CAM] ESP32 stream pending</p>
        <p>[NET] Connected to host</p>
        <p>[IR] Edge protection active</p>
      </div>

      </div>
    </div>
  );
}

// COMPONENTS
const Status = ({ label, value }) => (
  <div className="flex justify-between bg-[#0b1e36] p-2 rounded">
    <span className="text-gray-400">{label}</span>
    <span className="font-bold">{value}</span>
  </div>
);

const Sensor = ({ label, status }) => (
  <div className="flex justify-between py-2 border-b border-gray-700">
    <span className="text-gray-400">{label}</span>
    <span className="text-cyan-400">{status}</span>
  </div>
);

export default Dashboard;
