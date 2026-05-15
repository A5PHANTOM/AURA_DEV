import React, { useState } from "react";
import Navbar from "../components/Navbar";
import Starfield from "../components/Starfield";
import { API_URL } from "../services/faceService";

function Chatbot() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setError("");
    setLoading(true);

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");

    try {
      const response = await fetch(`${API_URL}/chatbot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error("Chatbot request failed");
      }

      const data = await response.json();
      setMessages([
        ...nextMessages,
        { role: "assistant", content: data.reply || "(empty reply)" },
      ]);
    } catch (err) {
      console.error(err);
      setError("Chatbot is not available right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-4xl bg-white/5 backdrop-blur-xl p-6 rounded-3xl shadow-[0_0_60px_rgba(0,255,255,0.25)] space-y-4 z-10 border border-cyan-500/30">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-cyan-400 mb-1 tracking-wide">
              AURA Chatbot
            </h1>
            <p className="text-xs md:text-sm text-slate-300">
              Project-aware assistant for questions about the rover, patrols,
              sensors, alerts, and analytics.
            </p>
          </div>
          <span className="text-[11px] text-slate-400 italic">
            Hidden page · open via <span className="font-mono">/chatbot</span>
          </span>
        </div>

        <div className="bg-black/70 rounded-2xl border border-white/15 p-4 h-80 md:h-96 overflow-y-auto space-y-2 text-sm">
          {messages.length === 0 && (
            <p className="text-slate-500 text-xs">
              Start by asking something like
              {" "}
              <span className="italic">
                "What happened during the last patrol?"
              </span>
              {" "}
              or
              {" "}
              <span className="italic">
                "When was the last fire or gas alert?"
              </span>
              .
            </p>
          )}

          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs md:text-sm shadow-md whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-cyan-500/20 border border-cyan-400/60 text-cyan-50"
                    : "bg-white/10 border border-white/15 text-slate-50"
                }`}
              >
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-0.5">
                  {m.role === "user" ? "You" : "AURA AI"}
                </div>
                <div>{m.content}</div>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-900/40 border border-red-500/40 rounded-xl px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={sendMessage} className="flex flex-col md:flex-row gap-2 mt-2">
          <input
            type="text"
            className="flex-1 rounded-2xl px-3 py-2 text-sm bg-black/70 border border-cyan-500/40 text-white outline-none focus:ring-2 focus:ring-cyan-400/70"
            placeholder="Ask about AURA patrols, sensors, alerts, analytics…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded-2xl text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-600 text-black shadow-lg transition-colors"
          >
            {loading ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Chatbot;
