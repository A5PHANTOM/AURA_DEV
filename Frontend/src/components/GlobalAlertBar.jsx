import { useEffect, useState, useRef } from "react";
import { ESP32_API, GAS_THRESHOLD } from "../services/espConfig";

export default function GlobalAlertBar() {
  const [alert, setAlert] = useState(null);
  const [visible, setVisible] = useState(false);
  const acknowledgedRef = useRef(false);

  useEffect(() => {
    const poll = () => {
      fetch(`${ESP32_API}/status`)
        .then((r) => r.json())
        .then((data) => {
          const fire = !!data?.flame;
          const gasVal = data?.gas;
          const gasHigh = gasVal != null && gasVal > GAS_THRESHOLD;

          if ((fire || gasHigh) && !acknowledgedRef.current) {
            const type = fire ? "fire" : "gas";
            const msg = fire
              ? "Fire detected by flame sensor"
              : `Gas level HIGH (${gasVal})`;
            setAlert({ type, message: msg, state: data?.state || "" });
            setVisible(true);
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

  if (!visible || !alert) return null;

  const toneLabel = alert.type === "fire" ? "FIRE" : "GAS";

  const handleOff = async () => {
    acknowledgedRef.current = true;
    setVisible(false);
    try {
      await fetch(`${ESP32_API}/buzzer/off`);
    } catch (e) {
      // ignore; user still acknowledged
    }
  };

  return (
    <div className="fixed top-16 left-0 right-0 flex justify-center z-40 pointer-events-none">
      <div className="pointer-events-auto max-w-xl w-[90%] bg-red-600/90 border border-red-300 shadow-2xl rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-white">
        <div className="flex flex-col flex-1">
          <span className="text-xs font-semibold tracking-wide uppercase text-red-100">
            Critical {toneLabel} alert
          </span>
          <span className="text-sm font-medium">{alert.message}</span>
          {alert.state && (
            <span className="text-[11px] text-red-100/80 mt-0.5">
              Rover state: {alert.state}
            </span>
          )}
          <span className="text-[11px] text-red-100/80 mt-1">
            Buzzer is active on the rover. Press OFF to silence it.
          </span>
        </div>
        <button
          onClick={handleOff}
          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 border border-white/40"
        >
          OFF
        </button>
      </div>
    </div>
  );
}
