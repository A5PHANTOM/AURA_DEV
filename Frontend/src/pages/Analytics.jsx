import { useEffect, useState, useRef } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { API_URL as BACKEND_API } from "../services/faceService";
import { ESP32_API, GAS_THRESHOLD } from "../services/espConfig";

function Bar({ label, value, color }) {
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex flex-col items-start gap-1 text-xs text-slate-200">
      <div className="flex justify-between items-center w-full">
        <span>{label}</span>
        <span className="text-[11px] text-slate-300">{clamped}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clamped}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function Analytics() {
  const [espStatus, setEspStatus] = useState(null);
  const [espError, setEspError] = useState("");

  const lastFlameRef = useRef(false);
  const [fireEvents, setFireEvents] = useState([]);

  const lastGasHighRef = useRef(false);
  const lastEdgeRef = useRef(false);
  const lastDistanceCriticalRef = useRef(false);

  const [logs, setLogs] = useState([]);
  const [logsError, setLogsError] = useState("");

  const [batteryLevel] = useState(() => 60 + Math.round(Math.random() * 35));
  const [systemHealth] = useState(() => 70 + Math.round(Math.random() * 25));
  const [sensorHealth] = useState(() => 65 + Math.round(Math.random() * 30));

  const [detectionsSeries] = useState(() => {
    // sample detections per hour (kept as fake counts for now)
    return Array.from({ length: 8 }).map((_, i) => ({
      label: `${i * 3}:00`,
      value: 5 + Math.round(Math.random() * 20),
    }));
  });

  const loadLogs = () => {
    fetch(`${BACKEND_API}/logs?limit=200`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setLogs(data);
        } else {
          setLogs([]);
        }
        setLogsError("");
      })
      .catch(() => {
        setLogsError("Failed to load logs from backend");
      });
  };

  useEffect(() => {
    const poll = () => {
      fetch(`${ESP32_API}/status`)
        .then((r) => r.json())
        .then((data) => {
          setEspStatus(data);
          setEspError("");

          const flameNow = !!data?.flame;
          if (flameNow && !lastFlameRef.current) {
            setFireEvents((prev) => [
              {
                id: Date.now(),
                time: new Date().toLocaleTimeString(),
                message: "Flame sensor detected FIRE",
              },
              ...prev,
            ].slice(0, 30));

            // persist to backend logs
            fetch(`${BACKEND_API}/logs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: "alert",
                source: "esp32",
                category: "flame",
                message: "Flame sensor detected FIRE",
                data,
              }),
            }).catch(() => {});

            loadLogs();
          }
          lastFlameRef.current = flameNow;

          const gasVal = data?.gas;
          const gasHigh = gasVal != null && gasVal > GAS_THRESHOLD;
          if (gasHigh && !lastGasHighRef.current) {
            fetch(`${BACKEND_API}/logs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: "warning",
                source: "esp32",
                category: "gas",
                message: `Gas level HIGH (${gasVal})`,
                data,
              }),
            }).catch(() => {});
            loadLogs();
          }
          lastGasHighRef.current = gasHigh;

          const edgeNow = !!data?.edge;
          if (edgeNow && !lastEdgeRef.current) {
            fetch(`${BACKEND_API}/logs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: "warning",
                source: "esp32",
                category: "edge",
                message: "Edge detected by IR sensor",
                data,
              }),
            }).catch(() => {});
            loadLogs();
          }
          lastEdgeRef.current = edgeNow;

          const dist = typeof data?.distance === "number" ? data.distance : null;
          const distCritical = dist !== null && dist < 15;
          if (distCritical && !lastDistanceCriticalRef.current) {
            fetch(`${BACKEND_API}/logs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: "warning",
                source: "esp32",
                category: "ultrasonic",
                message: `Obstacle detected within ${dist} cm`,
                data,
              }),
            }).catch(() => {});
            loadLogs();
          }
          lastDistanceCriticalRef.current = distCritical;
        })
        .catch(() => {
          setEspError("ESP32 status not reachable");
        });
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadLogs();
    const id = setInterval(loadLogs, 10000);
    return () => clearInterval(id);
  }, []);

  const gasValue = espStatus?.gas ?? null;
  const gasState =
    gasValue == null ? "Unknown" : gasValue > GAS_THRESHOLD ? "HIGH" : "OK";

  const flameDetected = !!espStatus?.flame;
  const edgeDetected = !!espStatus?.edge;
  const distance = espStatus?.distance;

  const gasAlertCount = logs.filter((l) => l.category === "gas").length;
  const flameAlertCount = logs.filter((l) => l.category === "flame").length;
  const edgeAlertCount = logs.filter((l) => l.category === "edge").length;
  const ultrasonicAlertCount = logs.filter((l) => l.category === "ultrasonic").length;

  const alertsSeries = [
    { label: "Gas", key: "gas", value: gasAlertCount },
    { label: "Flame", key: "flame", value: flameAlertCount },
    { label: "Edge", key: "edge", value: edgeAlertCount },
    { label: "Obstacle", key: "ultrasonic", value: ultrasonicAlertCount },
  ];

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-6xl bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-2xl space-y-6 z-10 border border-white/10">
        <div className="flex flex-col gap-2 text-white">
          <h1 className="text-3xl font-bold text-cyan-400">System Analytics</h1>
          <p className="text-sm text-slate-300 max-w-2xl">
            Overview of rover sensors, face-recognition activity, and system health.
            Sensor metrics are live from the ESP32, while charts below are simulated
            for visualization.
          </p>
          {flameDetected && (
            <div className="mt-1 bg-red-500/20 border border-red-500/60 text-red-100 text-xs px-3 py-2 rounded-lg max-w-md">
              FIRE DETECTED by flame sensor (live)
            </div>
          )}
        </div>

        {/* Top summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-white">
          <div className="bg-black/60 border border-white/10 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200 mb-1">System Health</h2>
            <Bar label="Overall" value={systemHealth} color="#22c55e" />
            <Bar label="Sensors" value={sensorHealth} color="#38bdf8" />
            <Bar label="Connectivity" value={90} color="#a855f7" />
          </div>

          <div className="bg-black/60 border border-white/10 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200 mb-1">Battery & Load</h2>
            <Bar label="Battery" value={batteryLevel} color="#f97316" />
            <Bar label="CPU Load" value={40 + Math.round(Math.random() * 30)} color="#22c55e" />
            <Bar label="Storage" value={30 + Math.round(Math.random() * 20)} color="#38bdf8" />
          </div>

          <div className="bg-black/60 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
            <h2 className="text-sm font-semibold text-slate-200 mb-1">Live Rover Status</h2>
            <p className="text-xs text-slate-300">
              State: <span className="font-semibold">{espStatus?.state ?? "UNKNOWN"}</span>
            </p>
            <p className="text-xs text-slate-300">
              Distance: <span className="font-semibold">{distance ?? "-"} cm</span>
            </p>
            <p className="text-xs text-slate-300">
              Gas: <span className="font-semibold">{gasValue ?? "-"}</span> ({gasState})
            </p>
            <p className="text-xs text-slate-300">
              Fire: <span className={`font-semibold ${flameDetected ? "text-red-400" : ""}`}>
                {flameDetected ? "DETECTED" : "Safe"}
              </span>
            </p>
            <p className="text-xs text-slate-300">
              Edge: <span className="font-semibold">{edgeDetected ? "EDGE" : "Clear"}</span>
            </p>
            {espError && (
              <p className="text-xs text-red-400 mt-1">{espError}</p>
            )}
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-white">
          <div className="bg-black/60 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Detections over time (sample)</h2>
            <div className="flex items-end gap-4 h-40">
              {detectionsSeries.map((p) => {
                const max = Math.max(...detectionsSeries.map((x) => x.value || 0), 1);
                const ratio = p.value / max;
                const px = 16 + ratio * 96; // 16–112px
                return (
                  <div key={p.label} className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className="w-8 md:w-9 rounded-t bg-cyan-400 hover:bg-cyan-300 shadow-md transition-all"
                      style={{ height: `${px}px` }}
                    />
                    <span className="text-[10px] text-slate-300">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-black/60 border border-white/10 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Alerts by type (sample)</h2>
            <div className="flex items-end gap-3 h-40">
              {alertsSeries.map((p) => {
                const max = Math.max(...alertsSeries.map((x) => x.value || 0), 1);
                const ratio = p.value / max;
                const base = p.value === 0 ? 8 : 18;
                const px = base + ratio * 90; // 18–108px (or 8px for zero)
                const colorMap = {
                  Gas: "#f97316",
                  Flame: "#ef4444",
                  Edge: "#22c55e",
                  Obstacle: "#38bdf8",
                };
                return (
                  <div key={p.label} className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className="w-9 rounded-t shadow-md transition-all"
                      style={{ height: `${px}px`, background: colorMap[p.label] || "#6366f1" }}
                    />
                    <span className="text-[11px] text-slate-300">{p.label}</span>
                    <span className="text-[10px] text-slate-400">{p.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sensor self-test pictorial section */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-white mt-2">
          {["Ultrasonic", "Gas", "Flame", "Edge"].map((name) => {
            let ok = true;
            if (name === "Gas" && gasValue != null) ok = gasValue <= GAS_THRESHOLD;
            if (name === "Flame") ok = !flameDetected;
            if (name === "Edge") ok = !edgeDetected;
            if (name === "Ultrasonic" && distance != null) ok = distance > 0;

            return (
              <div
                key={name}
                className="bg-black/60 border border-white/10 rounded-xl p-4 flex flex-col items-center gap-2 text-sm"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold ${
                    ok ? "bg-emerald-500/80 text-white" : "bg-red-500/80 text-white"
                  }`}
                >
                  {ok ? "OK" : "FAIL"}
                </div>
                <span className="text-slate-200">{name}</span>
                <span className="text-[11px] text-slate-400">
                  {ok ? "Sensor healthy" : "Check wiring / env"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Event log from backend + download option */}
        <div className="bg-black/60 border border-white/10 rounded-xl p-4 text-white text-sm">
          <div className="flex items-center justify-between mb-2 gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Event Log</h2>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${BACKEND_API}/logs/export?limit=1000`);
                  const text = await res.text();
                  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `aura-logs-${new Date().toISOString().slice(0, 10)}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (e) {
                  // ignore
                }
              }}
              className="text-[11px] px-2 py-1 rounded border border-white/20 text-slate-100 hover:bg-white/10"
            >
              Download CSV
            </button>
          </div>
          {logsError && (
            <p className="text-xs text-red-400 mb-1">{logsError}</p>
          )}
          {logs.length === 0 ? (
            <p className="text-xs text-slate-400">No logs stored yet.</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto text-xs">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center gap-2">
                  <span className="text-slate-500 whitespace-nowrap">
                    {log.created_at ? new Date(log.created_at).toLocaleTimeString() : ""}
                  </span>
                  <span className="uppercase text-[10px] text-amber-300">{log.level}</span>
                  {log.category && (
                    <span className="text-[10px] text-cyan-300">[{log.category}]</span>
                  )}
                  <span className="text-slate-200 truncate">{log.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
