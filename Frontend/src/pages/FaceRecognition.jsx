import React, { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Starfield from '../components/Starfield';
import { runFaceRecognition } from '../services/faceService';
import { ESP32_CAM_API } from '../services/espConfig';

export default function FaceRecognition() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detections, setDetections] = useState([]);
  const [mode, setMode] = useState('upload'); // 'upload' | 'camera'

  const [isLiveDetection, setIsLiveDetection] = useState(false);

  const [frameSize, setFrameSize] = useState({ width: null, height: null });

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setError('');
    setDetections([]);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Load image dimensions so we can scale detection boxes correctly
    const img = new Image();
    img.onload = () => {
      setFrameSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
  };

  useEffect(() => {
    return () => {
      setIsLiveDetection(false);
    };
  }, []);
  const fetchEsp32Snapshot = async () => {
    try {
      const res = await fetch(`${ESP32_CAM_API}/capture`);
      if (!res.ok) {
        throw new Error('Failed to fetch image from ESP32 camera');
      }
      const blob = await res.blob();
      if (!blob) return null;

      const file = new File([blob], 'esp32-frame.jpg', { type: blob.type || 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setSelectedFile(file);

      const img = new Image();
      img.onload = () => {
        setFrameSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = url;

      return file;
    } catch (e) {
      console.error(e);
      setError('ESP32 camera not reachable.');
      return null;
    }
  };

  const startCamera = async () => {
    setMode('camera');
    setError('');
    setDetections([]);
    await fetchEsp32Snapshot();
  };

  const captureFrameAsFile = async () => {
    return fetchEsp32Snapshot();
  };

  const captureFrameForLive = async () => {
    return fetchEsp32Snapshot();
  };

  const handleRunRecognition = async () => {
    let file = selectedFile;

    if (mode === 'camera') {
      file = await captureFrameAsFile();
    }

    if (!file) {
      setError('Please select an image or capture from camera first.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await runFaceRecognition(file);
      setDetections(data.detections || []);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Failed to run face recognition.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loop = async () => {
      while (!cancelled && isLiveDetection) {
        try {
          const file = await captureFrameForLive();
          if (!file) {
            setError('Unable to capture frame from camera.');
            break;
          }
          const data = await runFaceRecognition(file);
          setDetections(data.detections || []);
          setError('');
        } catch (err) {
          console.error(err);
          setError(err.response?.data?.detail || 'Failed to run live face recognition.');
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      setIsLiveDetection(false);
    };

    if (isLiveDetection) {
      loop();
    }

    return () => {
      cancelled = true;
    };
  }, [isLiveDetection]);

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black p-4 pt-20 relative overflow-hidden">
      <Starfield />
      <Navbar />

      <div className="w-full max-w-6xl bg-white/5 backdrop-blur-md p-6 rounded-2xl shadow-2xl space-y-6 z-10 border border-white/10">
        <div className="pt-4 text-white space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-cyan-400">Face Recognition</h1>
            <p className="text-sm text-slate-300 max-w-2xl">
              Upload an image or use the camera to detect and identify known faces.
            </p>
          </div>

          <div className="w-full max-w-3xl grid md:grid-cols-1 gap-8">
            {/* Image / camera and detections */}
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-xl font-semibold">Image / Camera</h2>
                <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setMode('upload')}
                className={`px-2 py-1 rounded ${mode === 'upload' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}
              >
                Upload
              </button>
              <button
                type="button"
                onClick={startCamera}
                className={`px-2 py-1 rounded ${mode === 'camera' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}
              >
                Camera
              </button>
                </div>
              </div>
          {mode === 'upload' && (
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="text-sm text-slate-200"
            />
          )}

          {mode === 'camera' && (
            <div className="mt-2 flex flex-col gap-3 items-start">
              <p className="text-xs text-slate-300">
                Source: ESP32 camera at {ESP32_CAM_API}. Snapshots from this camera are used for
                both preview and live face recognition.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={fetchEsp32Snapshot}
                  className="text-xs rounded bg-slate-800 hover:bg-slate-700 px-3 py-1"
                >
                  Capture snapshot
                </button>
                <button
                  type="button"
                  onClick={() => setIsLiveDetection((prev) => !prev)}
                  className="text-xs rounded bg-purple-600 hover:bg-purple-500 px-3 py-1"
                >
                  {isLiveDetection ? 'Stop Live Detection' : 'Start Live Detection'}
                </button>
              </div>
            </div>
          )}

          {previewUrl && (
            <div className="mt-2 flex justify-center">
              <div className="relative inline-block">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-h-64 rounded-lg border border-slate-700 object-contain"
                />
                {frameSize.width && frameSize.height && detections.map((d, idx) => {
                  const bbox = d.bbox || [];
                  if (bbox.length !== 4) return null;
                  const [x1, y1, x2, y2] = bbox;
                  const left = (x1 / frameSize.width) * 100;
                  const top = (y1 / frameSize.height) * 100;
                  const width = ((x2 - x1) / frameSize.width) * 100;
                  const height = ((y2 - y1) / frameSize.height) * 100;
                  const isUnknown = !d.person_name || d.person_name === 'Unknown';
                  const borderColor = isUnknown ? 'border-red-500' : 'border-emerald-400';
                  const bgColor = isUnknown ? 'bg-red-500' : 'bg-emerald-500';
                    const showScore = typeof d.match_score === 'number' && d.match_score >= 0.2;
                  const scoreLabel = showScore ? ` (${(d.match_score * 100).toFixed(1)}%)` : '';
                  return (
                    <div
                      key={idx}
                      className={`absolute border-2 ${borderColor} pointer-events-none`}
                      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                    >
                      <div
                        className={`absolute left-0 -top-5 px-1 py-0.5 text-[10px] font-semibold text-white rounded ${bgColor}`}
                      >
                        {isUnknown ? 'Unknown' : d.person_name}
                        {scoreLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={handleRunRecognition}
            disabled={loading}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 text-sm font-semibold"
          >
            {loading ? 'Running...' : 'Run Face Recognition'}
          </button>

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

          {detections.length > 0 && (
            <div className="mt-4 text-sm">
              <p className="font-semibold mb-1">Detections: {detections.length}</p>
              <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {detections.map((d, idx) => (
                  <li
                    key={idx}
                    className="border border-slate-700 rounded-md px-2 py-1 flex justify-between gap-2"
                  >
                    <span>#{idx + 1}</span>
                    <span className="truncate">
                      {d.person_name ?? 'Unknown'}
                          {typeof d.match_score === 'number' && d.match_score >= 0.2
                        ? ` - ${(d.match_score * 100).toFixed(1)}% match`
                        : d.distance != null && typeof d.match_score !== 'number'
                        ? ` - dist ${d.distance.toFixed(2)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
    </div>
  );
}
