import { useEffect, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { ESP32_ROVER_API, ESP32_CAM_API, GAS_THRESHOLD } from "../services/espConfig";
import { runFaceRecognition, API_URL as BACKEND_API } from "../services/faceService";

export default function Manual() {
  const [data, setData] = useState({});
  const [moveMessage, setMoveMessage] = useState("");
  const [cameraFrameUrl, setCameraFrameUrl] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [detections, setDetections] = useState([]);
  const [frameSize, setFrameSize] = useState({ width: null, height: null });
  const lastRecognitionAtRef = useRef(0);
  const recognitionInFlightRef = useRef(false);
  const lastFlameRef = useRef(false);
  const lastGasHighRef = useRef(false);

  const move = async (dir) => {
    try {
      const res = await fetch(`${ESP32_ROVER_API}/move?dir=${dir}`);
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // ignore parse errors
      }

      if (!res.ok) {
        if (json?.error === "SAFETY_ACTIVE") {
          setMoveMessage(`Blocked: safety active (${json.state})`);
        } else {
          setMoveMessage("Move failed");
        }
      } else if (json?.state) {
        setMoveMessage(`State: ${json.state}`);
      } else {
        setMoveMessage("");
      }
    } catch (e) {
      setMoveMessage("ESP32 not reachable");
    }
  };

  useEffect(() => {
    const down = (e) => {
      if (e.key === "w") move("forward");
      if (e.key === "s") move("backward");
      if (e.key === "a") move("left");
      if (e.key === "d") move("right");
    };
    const up = () => move("stop");

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const i = setInterval(() => {
      fetch(`${ESP32_ROVER_API}/status`)
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Trigger backend fire / gas alerts (and thus Telegram) when sensor state changes
  useEffect(() => {
    const flameNow = !!data.flame;
    if (flameNow && !lastFlameRef.current) {
      fetch(`${BACKEND_API}/alert/fire`, { method: "POST" }).catch(() => {});
    }
    lastFlameRef.current = flameNow;

    const gasVal = data.gas;
    const gasHigh = gasVal != null && gasVal > GAS_THRESHOLD;
    if (gasHigh && !lastGasHighRef.current) {
      fetch(`${BACKEND_API}/alert/gas`, { method: "POST" }).catch(() => {});
    }
    lastGasHighRef.current = gasHigh;
  }, [data]);

  useEffect(() => {
    let cancelled = false;

    const loop = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${ESP32_CAM_API}/capture`);
          if (!res.ok) throw new Error("ESP32 capture failed");
          const blob = await res.blob();
          if (!blob || cancelled) break;

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
          const MIN_INTERVAL_MS = 1500;
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
                // ignore recognition errors, keep camera running
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

        // small delay between frames to avoid hammering the ESP32
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    loop();

    return () => {
      cancelled = true;
      setCameraFrameUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      setDetections([]);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-6xl bg-white/5 backdrop-blur-xl p-6 rounded-3xl shadow-[0_0_80px_rgba(0,255,255,0.25)] space-y-6 z-10 border border-cyan-500/30">
        <div className="flex flex-col md:flex-row gap-6 text-white">
          {/* LEFT: Live camera + status */}
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-3xl font-bold text-cyan-400 mb-1 tracking-wide">
                Manual Rover Control
              </h1>
              <p className="text-sm text-slate-300">
                Use WASD or tap the control pad to drive the rover in real time
                while monitoring live camera and safety sensors.
              </p>
            </div>

            <div className="bg-black/70 rounded-2xl border border-cyan-500/50 p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-[0.2em]">LIVE CAMERA</h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-400/40">
                  {data.state || "IDLE"}
                </span>
              </div>
              <div className="flex items-center justify-center border border-cyan-500/40 rounded-xl bg-gradient-to-br from-slate-900 via-black to-slate-900 min-h-[220px] overflow-hidden">
                {cameraFrameUrl ? (
                  <div className="relative">
                    <img
                      src={cameraFrameUrl}
                      alt="ESP32 live view"
                      className="max-h-72 rounded-lg object-contain shadow-[0_0_40px_rgba(34,211,238,0.35)]"
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
              <p className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>{cameraError || `ESP32-CAM at ${ESP32_CAM_API}`}</span>
                <span className="italic">Hold W/A/S/D to drive · Release to stop</span>
              </p>
            </div>
          </div>

          {/* RIGHT: Controls + telemetry */}
          <div className="w-full md:w-80 space-y-4">
            <div className="bg-black/70 rounded-2xl border border-white/15 p-4 flex flex-col items-center gap-4">
              <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-[0.2em]">DRIVE CONTROL</h2>

              <div className="grid grid-cols-3 gap-3 w-48">
                <div />
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors"
                  type="button"
                  onPointerDown={() => move("forward")}
                  onPointerUp={() => move("stop")}
                  onPointerLeave={() => move("stop")}
                >
                  ↑
                </button>
                <div />
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors"
                  type="button"
                  onPointerDown={() => move("left")}
                  onPointerUp={() => move("stop")}
                  onPointerLeave={() => move("stop")}
                >
                  ←
                </button>
                <button
                  className="bg-white/10 hover:bg-red-500/40 border border-red-400/60 text-white py-2 rounded-xl text-xs font-semibold shadow-lg transition-colors col-span-1"
                  type="button"
                  onClick={() => move("stop")}
                >
                  STOP
                </button>
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors"
                  type="button"
                  onPointerDown={() => move("right")}
                  onPointerUp={() => move("stop")}
                  onPointerLeave={() => move("stop")}
                >
                  →
                </button>
                <div />
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors col-span-3"
                  type="button"
                  onPointerDown={() => move("backward")}
                  onPointerUp={() => move("stop")}
                  onPointerLeave={() => move("stop")}
                >
                  ↓
                </button>
              </div>

              <p className="text-[11px] text-slate-400 text-center">
                Keyboard mapping: <span className="font-mono text-slate-200">W/A/S/D</span>
              </p>
            </div>

            <div className="bg-black/70 rounded-2xl border border-white/15 p-4 space-y-2 text-sm">
              <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-[0.2em] mb-1">TELEMETRY</h2>
              <div className="grid grid-cols-2 gap-3">
                <Telemetry label="Distance" value={data.distance != null ? `${data.distance} cm` : "-"} accent="cyan" />
                <Telemetry label="Edge" value={data.edge ? "DETECTED" : "Clear"} accent={data.edge ? "red" : "emerald"} />
                <Telemetry
                  label="Gas"
                  value={data.gas != null ? `${data.gas} (${data.gas > GAS_THRESHOLD ? "HIGH" : "OK"})` : "-"}
                  accent={data.gas != null && data.gas > GAS_THRESHOLD ? "red" : "amber"}
                />
                <Telemetry label="Fire" value={data.flame ? "DETECTED" : "Safe"} accent={data.flame ? "red" : "emerald"} />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                <span>State: <span className="font-mono text-slate-100">{data.state ?? "UNKNOWN"}</span></span>
                {moveMessage && (
                  <span className="text-yellow-300">{moveMessage}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Telemetry({ label, value, accent }) {
  const colorMap = {
    cyan: "text-cyan-300 border-cyan-500/40",
    emerald: "text-emerald-300 border-emerald-500/40",
    red: "text-red-300 border-red-500/40",
    amber: "text-amber-300 border-amber-500/40",
  };
  const classes = colorMap[accent] || colorMap.cyan;

  return (
    <div className={`bg-white/5 rounded-xl border px-3 py-2 flex flex-col gap-0.5 ${classes}`}>
      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
