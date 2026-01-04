import { useEffect, useState, useRef } from "react";
import { ESP32_ROVER_API, GAS_THRESHOLD } from "../services/espConfig";

export default function GlobalAlertBar() {
  const [alert, setAlert] = useState(null);
  const [visible, setVisible] = useState(false);
  const acknowledgedRef = useRef(false);
  const lastHazardRef = useRef(false);
  const audioCtxRef = useRef(null);
  const oscillatorRef = useRef(null);
  const gainRef = useRef(null);

  const triggerBrowserNotification = async (type, message, state) => {
    try {
      if (typeof window === "undefined" || typeof Notification === "undefined") {
        return;
      }

      if (Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          // ignore permission errors
        }
      }

      if (Notification.permission === "granted") {
        const title = type === "fire" ? "FIRE WARNING" : "GAS WARNING";
        const body = state ? `${message} | Rover: ${state}` : message;
        // tag prevents stacking unlimited duplicates
        new Notification(title, {
          body,
          tag: "aura-hazard",
          renotify: true,
        });
      }

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([250, 150, 250, 400]);
      }
    } catch {
      // notifications are best-effort
    }
  };

  useEffect(() => {
    const poll = () => {
      fetch(`${ESP32_ROVER_API}/status`)
        .then((r) => r.json())
        .then((data) => {
          const fire = !!data?.flame;
          const gasVal = data?.gas;
          const gasHigh = gasVal != null && gasVal > GAS_THRESHOLD;

          const hazardActive = fire || gasHigh;

          if (hazardActive && !acknowledgedRef.current) {
            const type = fire ? "fire" : "gas";
            const msg = fire
              ? "Fire detected by flame sensor"
              : `Gas level HIGH (${gasVal})`;

            setAlert({ type, message: msg, state: data?.state || "" });
            setVisible(true);

            // Only fire system notification on rising edge
            if (!lastHazardRef.current) {
              lastHazardRef.current = true;
              triggerBrowserNotification(type, msg, data?.state || "");
            }
          } else if (!hazardActive) {
            lastHazardRef.current = false;
          }
        })
        .catch(() => {
          // ignore errors here; alerts are best-effort
        });
    };

    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, []);

  const stopAlarm = () => {
    try {
      if (oscillatorRef.current) {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
        oscillatorRef.current = null;
      }
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
      // keep AudioContext for reuse, just suspend
      if (audioCtxRef.current && audioCtxRef.current.state === "running") {
        audioCtxRef.current.suspend();
      }
    } catch {
      // ignore audio errors
    }
  };

  const startAlarm = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // resume if previously suspended (may still fail without user interaction)
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      // stop any existing alarm first
      if (oscillatorRef.current) {
        stopAlarm();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(900, ctx.currentTime);

      // simple pulsing siren effect
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.2);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.7);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();

      oscillatorRef.current = osc;
      gainRef.current = gain;
    } catch {
      // if audio fails, we still show visual alert
    }
  };

  useEffect(() => {
    if (visible && alert) {
      startAlarm();
    } else {
      stopAlarm();
    }
  }, [visible, alert]);

  useEffect(() => {
    return () => {
      stopAlarm();
    };
  }, []);

  if (!visible || !alert) return null;

  const toneLabel = alert.type === "fire" ? "FIRE" : "GAS";

  const handleOff = async () => {
    acknowledgedRef.current = true;
    setVisible(false);
    stopAlarm();
    try {
      await fetch(`${ESP32_ROVER_API}/buzzer/off`);
    } catch (e) {
      // ignore; user still acknowledged
    }
  };
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80">
      <div className="max-w-md w-[90%] bg-red-700 border border-red-300 shadow-2xl rounded-2xl px-6 py-5 flex flex-col gap-3 text-white text-sm">
        <div className="text-center mb-1">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase text-red-100">
            {toneLabel} WARNING
          </div>
          <div className="mt-2 text-lg font-bold">Hazard Detected</div>
        </div>

        <div className="flex flex-col gap-1 text-center">
          <span className="text-sm font-medium">{alert.message}</span>
          {alert.state && (
            <span className="text-[11px] text-red-100/80 mt-0.5">
              Rover state: {alert.state}
            </span>
          )}
          <span className="text-[11px] text-red-100/80 mt-1">
            An audible alarm is playing in the browser and on the rover.
            Press OK to acknowledge and silence.
          </span>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            onClick={handleOff}
            className="px-5 py-2 rounded-lg bg-black/60 hover:bg-black/80 border border-white/60 text-xs font-semibold tracking-wide uppercase"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
