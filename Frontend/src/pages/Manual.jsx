import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { ESP32_API, GAS_THRESHOLD } from "../services/espConfig";

export default function Manual() {
  const [data, setData] = useState({});
  const [moveMessage, setMoveMessage] = useState("");

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

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-6xl bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-2xl space-y-6 z-10 border border-white/10">
        <div className="pt-4 px-6 text-white">
          <h1 className="text-3xl font-bold text-cyan-400 mb-6">Manual Rover Control</h1>

          <div className="grid grid-cols-3 gap-4 w-64 mx-auto mb-8">
            <button className="btn bg-white/10 text-white p-3 rounded" onClick={() => move("forward")}>↑</button>
            <button className="btn bg-white/10 text-white p-3 rounded" onClick={() => move("left")}>←</button>
            <button className="btn bg-white/10 text-white p-3 rounded" onClick={() => move("right")}>→</button>
            <button className="btn col-span-3 bg-white/10 text-white p-3 rounded" onClick={() => move("backward")}>↓</button>
          </div>

          <div className="bg-black/60 p-4 rounded-lg space-y-1">
            <p>Distance: {data.distance ?? "-"} cm</p>
            <p>Edge: {data.edge ? "DETECTED" : "Clear"}</p>
            <p>
              Gas: {data.gas ?? "-"}
              {data.gas != null && ` (${data.gas > GAS_THRESHOLD ? "HIGH" : "OK"})`}
            </p>
            <p>Fire: {data.flame ? "DETECTED" : "Safe"}</p>
            <p>State: {data.state ?? "UNKNOWN"}</p>
            {moveMessage && (
              <p className="text-xs text-yellow-300 mt-1">{moveMessage}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
