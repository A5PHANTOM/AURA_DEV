import { useEffect, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { ESP32_ROVER_API, ESP32_CAM_API } from "../services/espConfig";
// Backend API (FastAPI) for storing patrol paths
import { API_URL as BACKEND_API } from "../services/faceService";
import { runFaceRecognition } from "../services/faceService";

const ACTION_OPTIONS = [
  { value: "forward", label: "Forward" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "backward", label: "Backward" },
];

export default function Patrol() {
  const [steps, setSteps] = useState([]);
  const [currentAction, setCurrentAction] = useState("forward");
  const [currentTime, setCurrentTime] = useState(1000);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [pathName, setPathName] = useState("");
  const [scheduleInput, setScheduleInput] = useState("");
  const [scheduleSlots, setScheduleSlots] = useState([]);
  const [savedPaths, setSavedPaths] = useState([]);
  const [selectedPathId, setSelectedPathId] = useState(null);
  const [cameraFrameUrl, setCameraFrameUrl] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [detections, setDetections] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [analyzingSessionId, setAnalyzingSessionId] = useState(null);
  const [frameSize, setFrameSize] = useState({ width: null, height: null });
  const lastRecognitionAtRef = useRef(0);
  const recognitionInFlightRef = useRef(false);

  const addStep = () => {
    const t = Number(currentTime);
    if (!t || t <= 0) return;
    setSteps((prev) => [...prev, { action: currentAction, time: t }]);
  };

  const clearSteps = () => {
    setSteps([]);
    setStatus("");
  };

  const loadSavedPaths = async () => {
    try {
      const res = await fetch(`${BACKEND_API}/patrol-paths`);
      const data = await res.json();
      setSavedPaths(Array.isArray(data) ? data : []);
    } catch {
      // ignore for now
    }
  };

  const sendPath = async () => {
    if (steps.length === 0) {
      setStatus("Add at least one step.");
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/rover/patrol/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(steps),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.detail || data.error || "Failed to set patrol path.");
      } else {
        setStatus(`Path set with ${data.steps ?? steps.length} steps.`);
      }
    } catch (e) {
      setStatus("Backend patrol proxy not reachable.");
    } finally {
      setLoading(false);
    }
  };

  const savePathToBackend = async () => {
    if (!pathName.trim()) {
      setStatus("Enter a name for this path.");
      return;
    }
    if (steps.length === 0) {
      setStatus("Add at least one step before saving.");
      return;
    }

    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/patrol-paths`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pathName.trim(),
          steps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.detail || data.error || "Failed to save path.");
      } else {
        setStatus("Path saved.");
        setPathName("");
        // refresh list
        loadSavedPaths();
      }
    } catch (e) {
      setStatus("Backend not reachable.");
    } finally {
      setLoading(false);
    }
  };

  const selectSavedPath = (path) => {
    setSelectedPathId(path.id);
    setSteps(path.steps || []);
    setPathName(path.name || "");
    setScheduleSlots(Array.isArray(path.schedule_slots) ? path.schedule_slots : []);
    setScheduleInput("");
    setStatus("Loaded saved path.");
  };

  const saveScheduleForSelectedPath = async () => {
    if (!selectedPathId) {
      setStatus("Select a path first.");
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/patrol-paths/${selectedPathId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slots: scheduleSlots,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.detail || data.error || "Failed to save schedule.");
      } else {
        setStatus("Schedule updated.");
        // sync local list
        setSavedPaths((prev) =>
          prev.map((p) =>
            p.id === selectedPathId
              ? { ...p, schedule_slots: data.schedule_slots }
              : p
          )
        );
      }
    } catch (e) {
      setStatus("Backend not reachable.");
    } finally {
      setLoading(false);
    }
  };

  const deleteSavedPath = async (id) => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/patrol-paths/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(data.detail || data.error || "Failed to delete path.");
      } else {
        setSavedPaths((prev) => prev.filter((p) => p.id !== id));
        if (selectedPathId === id) {
          setSelectedPathId(null);
        }
        setStatus("Path deleted.");
      }
    } catch (e) {
      setStatus("Backend not reachable.");
    } finally {
      setLoading(false);
    }
  };

  // Initial load of saved paths
  useEffect(() => {
    loadSavedPaths();
  }, []);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${BACKEND_API}/patrol-sessions?limit=50`);
      if (!res.ok) throw new Error("Failed to load patrol sessions");
      const data = await res.json();
      if (Array.isArray(data)) {
        setSessions(data);
        setSessionsError("");
      } else {
        setSessions([]);
        setSessionsError("Unexpected patrol sessions payload");
      }
    } catch (e) {
      setSessions([]);
      setSessionsError("Failed to load patrol sessions from backend");
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

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
        const MIN_INTERVAL_MS = 2000;
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

    fetchFrame();
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

  const startPatrol = async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/rover/patrol/start`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.detail || data.error || "Failed to start patrol.");
      } else {
        setStatus(data.state || "Patrol started.");
        try {
          await fetch(`${BACKEND_API}/patrol-sessions/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patrol_path_id: selectedPathId || null }),
          });
          loadSessions();
        } catch (e) {
          // best-effort; ignore
        }
      }
    } catch (e) {
      setStatus("Backend patrol proxy not reachable.");
    } finally {
      setLoading(false);
    }
  };

  const stopPatrol = async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/rover/patrol/stop`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.detail || data.error || "Failed to stop patrol.");
      } else {
        setStatus(data.state || "Patrol stopped.");
        try {
          await fetch(`${BACKEND_API}/patrol-sessions/stop`, {
            method: "POST",
          });
          loadSessions();
        } catch (e) {
          // best-effort; ignore
        }
      }
    } catch (e) {
      setStatus("Backend patrol proxy not reachable.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-6xl bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-2xl space-y-6 z-10 border border-white/10">
        <div className="pt-4 px-6 text-white space-y-6">
          <h1 className="text-3xl font-bold text-cyan-400 mb-2">Patrol Route</h1>
          <p className="text-sm text-slate-300 max-w-xl">
            Define a patrol path as a sequence of moves with durations (milliseconds).
            The path is sent to the ESP32 (/patrol/set), then you can start or stop patrol mode.
          </p>

          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* Builder */}
            <div className="bg-black/60 p-4 rounded-lg border border-white/10 flex-1 space-y-3">
              <h2 className="text-lg font-semibold mb-2">Add Step</h2>
              <div className="flex gap-3 items-center">
                <select
                  className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm"
                  value={currentAction}
                  onChange={(e) => setCurrentAction(e.target.value)}
                >
                  {ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={currentTime}
                  onChange={(e) => setCurrentTime(e.target.value)}
                  className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm w-28"
                />
                <span className="text-xs text-slate-300">ms</span>
                <button
                  type="button"
                  onClick={addStep}
                  className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded px-3 py-1"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={clearSteps}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-white rounded px-3 py-1"
                >
                  Clear
                </button>
              </div>

              <div className="mt-4 max-h-48 overflow-y-auto text-sm">
                {steps.length === 0 ? (
                  <p className="text-slate-400">No steps added yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {steps.map((s, idx) => (
                      <li
                        key={idx}
                        className="flex justify-between items-center border border-white/10 rounded px-2 py-1"
                      >
                        <span>#{idx + 1} - {s.action}</span>
                        <span>{s.time} ms</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Save section: name only (time is configured separately) */}
              <div className="mt-4 border-t border-white/10 pt-3 space-y-2 text-sm">
                <h3 className="text-sm font-semibold">Save Path</h3>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Path name (e.g. Night patrol)"
                    value={pathName}
                    onChange={(e) => setPathName(e.target.value)}
                    className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={savePathToBackend}
                    disabled={loading}
                    className="self-start text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white rounded px-3 py-1"
                  >
                    Save to DB
                  </button>
                </div>
              </div>
            </div>

            {/* Controls + saved paths */}
            <div className="bg-black/60 p-4 rounded-lg border border-white/10 w-full md:w-80 space-y-4">
              <h2 className="text-lg font-semibold mb-2">Patrol Control</h2>
              <button
                type="button"
                onClick={sendPath}
                disabled={loading}
                className="w-full mb-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded px-3 py-2 text-sm font-semibold"
              >
                {loading ? "Working..." : "Send Path to ESP32"}
              </button>
              <button
                type="button"
                onClick={startPatrol}
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded px-3 py-2 text-sm font-semibold"
              >
                Start Patrol
              </button>
              <button
                type="button"
                onClick={stopPatrol}
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white rounded px-3 py-2 text-sm font-semibold"
              >
                Stop Patrol
              </button>

              {status && (
                <p className="text-xs text-slate-200 mt-2 break-words">{status}</p>
              )}

              <div className="mt-4 border-t border-white/10 pt-3 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">Saved Paths</h3>
                  <button
                    type="button"
                    onClick={loadSavedPaths}
                    className="text-[11px] text-slate-300 hover:text-white underline"
                  >
                    Refresh
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {savedPaths.length === 0 ? (
                    <p className="text-xs text-slate-400">No saved paths.</p>
                  ) : (
                    savedPaths.map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between gap-2 border border-white/10 rounded px-2 py-1 text-xs ${selectedPathId === p.id ? "bg-white/10" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => selectSavedPath(p)}
                          className="flex-1 text-left truncate"
                        >
                          <div className="font-semibold truncate">{p.name}</div>
                          <div className="text-[11px] text-slate-300 truncate">
                            {p.steps?.length || 0} steps
                            {Array.isArray(p.schedule_slots) && p.schedule_slots.length > 0 &&
                              ` - ${p.schedule_slots.join(", ")}`}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedPath(p.id)}
                          className="text-[11px] text-red-400 hover:text-red-300 flex-shrink-0"
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {selectedPathId && (
                  <div className="mt-3 border-t border-white/10 pt-3 space-y-2 text-xs text-slate-300">
                    <h4 className="text-sm font-semibold text-white">Schedule selected path</h4>
                    <div className="flex flex-wrap gap-3 items-center">
                      <input
                        type="time"
                        value={scheduleInput}
                        onChange={(e) => setScheduleInput(e.target.value)}
                        className="bg-black/40 border border-white/20 rounded px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!scheduleInput) return;
                          if (!scheduleSlots.includes(scheduleInput)) {
                            setScheduleSlots((prev) => [...prev, scheduleInput].sort());
                          }
                          setScheduleInput("");
                        }}
                        className="text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white rounded px-2 py-1"
                      >
                        Add time
                      </button>
                    </div>
                    {scheduleSlots.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {scheduleSlots.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              setScheduleSlots((prev) => prev.filter((x) => x !== t))
                            }
                            className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] flex items-center gap-1"
                          >
                            <span>{t}</span>
                            <span className="text-red-300">×</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={saveScheduleForSelectedPath}
                      disabled={loading}
                      className="mt-1 text-[11px] bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white rounded px-3 py-1"
                    >
                      Save Schedule
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-xl font-semibold text-cyan-400 mb-2">Live Camera</h2>
            <div className="flex items-center justify-center border border-cyan-500 rounded-lg bg-black/60 min-h-[180px]">
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

          <div className="mt-6 border-t border-white/10 pt-4">
            <h2 className="text-xl font-semibold text-cyan-400 mb-2">Patrol History</h2>
            <p className="text-xs text-slate-300 mb-2 max-w-xl">
              Recent patrol runs with their start/end times and AI-generated
              summaries based on events and logs during each patrol.
            </p>
            {sessionsError && (
              <p className="text-xs text-red-400 mb-1">{sessionsError}</p>
            )}
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="text-slate-400">
                {sessionsLoading ? "Loading patrol sessions…" : `Showing ${sessions.length} session(s)`}
              </span>
              <button
                type="button"
                onClick={loadSessions}
                className="px-2 py-1 rounded border border-white/20 text-[11px] text-slate-100 hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-xs text-slate-400">No patrol sessions recorded yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2 text-xs">
                {sessions.map((s) => {
                  const start = s.start_time ? new Date(s.start_time) : null;
                  const end = s.end_time ? new Date(s.end_time) : null;
                  const range = start
                    ? `${start.toLocaleDateString()} ${start.toLocaleTimeString()}${
                        end ? ` → ${end.toLocaleTimeString()}` : " (ongoing)"
                      }`
                    : "Unknown time";
                  return (
                    <div
                      key={s.id}
                      className="border border-white/10 rounded-lg px-3 py-2 bg-black/40 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100">
                          Session #{s.id}
                          {s.patrol_path_name ? ` – ${s.patrol_path_name}` : ""}
                        </span>
                        <span className="text-[10px] uppercase text-slate-400">
                          {s.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-300">{range}</span>
                      <span className="text-[11px] text-slate-200 mt-1">
                        {s.ai_status === "succeeded"
                          ? s.ai_summary_short || "AI summary available."
                          : s.ai_status === "unavailable"
                          ? "AI server was unavailable for this patrol."
                          : s.ai_status === "failed"
                          ? "AI analysis failed for this patrol."
                          : "No AI summary yet for this patrol."}
                      </span>
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={analyzingSessionId === s.id}
                          onClick={async () => {
                            setAnalyzingSessionId(s.id);
                            try {
                              await fetch(`${BACKEND_API}/patrol-sessions/${s.id}/analyze`, {
                                method: "POST",
                              });
                              loadSessions();
                            } catch (e) {
                              // backend logs errors; keep UI simple
                            } finally {
                              setAnalyzingSessionId(null);
                            }
                          }}
                          className="text-[11px] px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white"
                        >
                          {analyzingSessionId === s.id ? "Analyzing…" : "Analyze with AI"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
