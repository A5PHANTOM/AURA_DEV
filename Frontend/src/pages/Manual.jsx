import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { ESP32_API, GAS_THRESHOLD } from "../services/espConfig";

export default function Manual() {
  const [data, setData] = useState({});
  const [moveMessage, setMoveMessage] = useState("");
  const [cameraFrameUrl, setCameraFrameUrl] = useState(null);
  const [cameraError, setCameraError] = useState("");

  const move = async (dir) => {
    try {
      const res = await fetch(`${ESP32_API}/move?dir=${dir}`);
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
      fetch(`${ESP32_API}/status`)
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loop = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${ESP32_API}/capture`);
          if (!res.ok) throw new Error("ESP32 capture failed");
          const blob = await res.blob();
          if (!blob || cancelled) break;

          const url = URL.createObjectURL(blob);
          setCameraFrameUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return url;
          });
          setCameraError("");
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
                  <img
                    src={cameraFrameUrl}
                    alt="ESP32 live view"
                    className="max-h-72 rounded-lg object-contain shadow-[0_0_40px_rgba(34,211,238,0.35)]"
                  />
                ) : (
                  <span className="text-gray-400 text-sm">CAMERA STREAM OFFLINE</span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>{cameraError || `ESP32-CAM at ${ESP32_API}`}</span>
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
                  onClick={() => move("forward")}
                >
                  ↑
                </button>
                <div />
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors"
                  onClick={() => move("left")}
                >
                  ←
                </button>
                <button
                  className="bg-white/10 hover:bg-red-500/40 border border-red-400/60 text-white py-2 rounded-xl text-xs font-semibold shadow-lg transition-colors col-span-1"
                  onClick={() => move("stop")}
                >
                  STOP
                </button>
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors"
                  onClick={() => move("right")}
                >
                  →
                </button>
                <div />
                <button
                  className="bg-white/10 hover:bg-cyan-500/30 border border-cyan-400/40 text-white py-2 rounded-xl text-xl shadow-lg transition-colors col-span-3"
                  onClick={() => move("backward")}
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
