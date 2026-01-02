import React, { useEffect, useRef, useState } from 'react';
import { API_URL, runFaceRecognition, registerPerson, listPeople, deletePerson } from '../services/faceService';

export default function FaceRecognition() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detections, setDetections] = useState([]);
  const [mode, setMode] = useState('upload'); // 'upload' | 'camera'

  const [isLiveDetection, setIsLiveDetection] = useState(false);

  const [people, setPeople] = useState([]);
  const [newPersonName, setNewPersonName] = useState('');

  const [personToDelete, setPersonToDelete] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setError('');
    setDetections([]);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  useEffect(() => {
    // Load known people list on mount
    (async () => {
      try {
        const data = await listPeople();
        setPeople(data || []);
      } catch (e) {
        // ignore for now
      }
    })();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      setIsLiveDetection(false);
    };
  }, []);

  // Ensure video element is always wired to the active camera stream
  useEffect(() => {
    if (mode !== 'camera') return;
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    const playVideo = () => {
      video.play().catch(() => {
        /* ignore play errors */
      });
    };
    if (video.readyState >= 2) {
      playVideo();
    } else {
      video.onloadedmetadata = playVideo;
    }
  }, [mode]);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera is not supported in this browser.');
        return;
      }

      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        // Ensure playback starts when metadata is ready (fixes black screen on some browsers)
        const playVideo = () => {
          video.play().catch(() => {
            /* ignore play errors */
          });
        };
        if (video.readyState >= 2) {
          playVideo();
        } else {
          video.onloadedmetadata = playVideo;
        }
      }
      streamRef.current = stream;
      setMode('camera');
      setError('');
    } catch (e) {
      console.error(e);
      setError('Unable to access camera. Please allow permissions and use localhost/https.');
    }
  };

  const stopCamera = () => {
    setIsLiveDetection(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const captureFrameAsFile = async () => {
    const video = videoRef.current;
    if (!video) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setSelectedFile(file);
        resolve(file);
      }, 'image/jpeg', 0.9);
    });
  };

  const captureFrameForLive = async () => {
    const video = videoRef.current;
    if (!video) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        const file = new File([blob], 'frame-live.jpg', { type: 'image/jpeg' });
        resolve(file);
      }, 'image/jpeg', 0.8);
    });
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

  const handleAddPerson = () => {
    // left intentionally empty, replaced by handleRegisterPerson
  };

  const handleRegisterPerson = async () => {
    const trimmed = newPersonName.trim();
    if (!trimmed) {
      setError('Please enter a name first.');
      return;
    }

    let file = selectedFile;
    if (mode === 'camera') {
      file = await captureFrameAsFile();
    }

    if (!file) {
      setError('Please select an image or capture from camera to register.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const person = await registerPerson(trimmed, file);
      setPeople((prev) => {
        if (prev.find((p) => p.id === person.id)) return prev;
        return [...prev, person];
      });
      setNewPersonName('');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Failed to register person.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!personToDelete) return;
    setLoading(true);
    setError('');
    try {
      await deletePerson(personToDelete.id);
      setPeople((prev) => prev.filter((p) => p.id !== personToDelete.id));
      setPersonToDelete(null);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Failed to delete person.');
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
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center py-10 px-4 gap-8">
      <h1 className="text-3xl font-bold">Face Recognition Test</h1>

      <div className="w-full max-w-3xl grid md:grid-cols-2 gap-8">
        {/* Left: image + detection */}
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
            <div className="mt-2 flex flex-col gap-2 items-center">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="max-h-64 rounded-lg border border-slate-700 bg-black"
              />
              <button
                type="button"
                onClick={stopCamera}
                className="text-xs text-slate-300 underline"
              >
                Stop camera
              </button>
              <button
                type="button"
                onClick={() => setIsLiveDetection((prev) => !prev)}
                className="text-xs mt-1 rounded bg-purple-600 hover:bg-purple-500 px-3 py-1"
              >
                {isLiveDetection ? 'Stop Live Detection' : 'Start Live Detection'}
              </button>
            </div>
          )}

          {previewUrl && (
            <div className="mt-2 flex justify-center">
              <img
                src={previewUrl}
                alt="Preview"
                className="max-h-64 rounded-lg border border-slate-700 object-contain"
              />
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
                      {typeof d.match_score === 'number'
                        ? ` - ${(d.match_score * 100).toFixed(1)}% match`
                        : d.distance != null
                        ? ` - dist ${d.distance.toFixed(2)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right: simple people list for testing */}
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 flex flex-col gap-4">
          <h2 className="text-xl font-semibold">People</h2>
          <p className="text-sm text-slate-300">
            Register people with a photo (uploaded image or camera frame),
            then run recognition to match faces in new images or live frames.
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              placeholder="Enter person name"
              className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleRegisterPerson}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-sm font-semibold"
            >
              Add / Update
            </button>
          </div>

          {people.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm max-h-40 overflow-y-auto pr-1">
              {people.map((p) => (
                <li
                  key={p.id}
                  className="border border-slate-700 rounded-md px-2 py-1 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {p.image_url && (
                      <img
                        src={`${API_URL}${p.image_url}`}
                        alt={p.name}
                        className="w-8 h-8 rounded-full object-cover border border-slate-600 flex-shrink-0"
                      />
                    )}
                    <span className="truncate">{p.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPersonToDelete(p)}
                    className="text-xs text-red-400 hover:text-red-300 ml-2"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 mt-1">No people added yet.</p>
          )}
        </div>
      </div>

      {personToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-white">Remove person?</h3>
            <div className="flex items-center gap-3">
              {personToDelete.image_url && (
                <img
                  src={`${API_URL}${personToDelete.image_url}`}
                  alt={personToDelete.name}
                  className="w-14 h-14 rounded-full object-cover border border-slate-600 flex-shrink-0"
                />
              )}
              <div>
                <p className="text-sm text-slate-200">{personToDelete.name}</p>
                <p className="text-xs text-slate-400">This will remove them and their face data.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setPersonToDelete(null)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-60"
                disabled={loading}
              >
                {loading ? 'Removing...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
