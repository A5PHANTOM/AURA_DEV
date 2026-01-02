import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { ESP32_API } from "../services/espConfig";
// Backend API (FastAPI) for storing patrol paths
import { API_URL as BACKEND_API } from "../services/faceService";

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
      const res = await fetch(`${ESP32_API}/patrol/set`, {
        method: "POST",
        // Send JSON, but let the browser use a simple Content-Type
        // (avoids a CORS preflight that the ESP32 server doesn't handle)
        body: JSON.stringify(steps),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Failed to set patrol path.");
      } else {
        setStatus(`Path set with ${data.steps ?? steps.length} steps.`);
      }
    } catch (e) {
      setStatus("ESP32 not reachable.");
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

  const startPatrol = async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${ESP32_API}/patrol/start`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Failed to start patrol.");
      } else {
        setStatus(data.state || "Patrol started.");
      }
    } catch (e) {
      setStatus("ESP32 not reachable.");
    } finally {
      setLoading(false);
    }
  };

  const stopPatrol = async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${ESP32_API}/patrol/stop`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Failed to stop patrol.");
      } else {
        setStatus(data.state || "Patrol stopped.");
      }
    } catch (e) {
      setStatus("ESP32 not reachable.");
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
        </div>
      </div>
    </div>
  );
}
