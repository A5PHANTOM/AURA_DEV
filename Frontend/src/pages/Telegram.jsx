import { useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { API_URL as BACKEND_API } from "../services/faceService";

export default function Telegram() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const trigger = async (type) => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${BACKEND_API}/alert/${type}`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Backend returned error");
      }
      const data = await res.json().catch(() => ({}));
      const sent = data.telegram_sent ? "Telegram notification sent" : "Telegram not sent (not configured)";
      setStatus(`${type.toUpperCase()} alert OK - ${sent}`);
    } catch (e) {
      setStatus(`Failed to trigger ${type} alert`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-xl bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-2xl space-y-4 z-10 border border-white/10 text-white">
        <h1 className="text-2xl font-bold text-cyan-400">Telegram Alerts</h1>
        <p className="text-sm text-slate-300">
          Use this page to test the fire and gas alert endpoints wired to your Telegram bot.
          Configure the backend with <span className="font-mono">TELEGRAM_BOT_TOKEN</span> and
          <span className="font-mono"> TELEGRAM_CHAT_ID</span> in the backend <span className="font-mono">.env</span> file.
        </p>

        <div className="flex flex-col gap-3 mt-2">
          <button
            disabled={loading}
            onClick={() => trigger("fire")}
            className="w-full py-2 rounded-lg bg-red-600/80 hover:bg-red-600 disabled:opacity-60 text-sm font-semibold"
          >
            {loading ? "Triggering FIRE..." : "Send FIRE test alert"}
          </button>
          <button
            disabled={loading}
            onClick={() => trigger("gas")}
            className="w-full py-2 rounded-lg bg-amber-500/80 hover:bg-amber-500 disabled:opacity-60 text-sm font-semibold"
          >
            {loading ? "Triggering GAS..." : "Send GAS test alert"}
          </button>
        </div>

        {status && (
          <div className="mt-3 text-xs px-3 py-2 rounded bg-black/60 border border-white/15">{status}</div>
        )}
      </div>
    </div>
  );
}
