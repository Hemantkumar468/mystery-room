import { useEffect, useRef, useState } from 'react';
import { Camera, Video, Circle, Square, RefreshCw, FileText, Upload } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { fmtDuration } from '../../../lib/format.js';

const VIDEO_MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const VIDEO_EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4' };

/**
 * Unified "add attachment" modal for `file` fields — three ways to attach:
 *  • Photo   — snapshot from the device camera
 *  • Video   — record a clip from the camera
 *  • Documents — pick any file(s) from the device
 * All three hand their result to the same deferred-upload pipeline (the caller
 * adds pending entries, uploaded on Save/Submit). The camera is only acquired
 * for Photo/Video and released on close/unmount, so the camera light never
 * lingers and picking documents never asks for camera permission.
 */
export function MediaCaptureModal({ open, onClose, onCapture, onSelectFiles, multiple = true, accept }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  const [mode, setMode] = useState('photo'); // photo | video | documents
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const stopTimer = () => clearInterval(timerRef.current);

  const teardown = () => {
    stopTimer();
    if (recorderRef.current) {
      recorderRef.current.onstop = null; // discard any in-flight recording
      try { recorderRef.current.stop(); } catch { /* already inactive */ }
      recorderRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
  };

  // Fresh open always starts on Photo.
  useEffect(() => { if (!open) setMode('photo'); }, [open]);

  // The camera is needed only in Photo/Video mode. Switching between Photo and
  // Video keeps `needsCamera` true, so the stream isn't torn down/re-acquired
  // on every tab switch — only entering/leaving the camera modes (or Documents)
  // toggles it.
  const needsCamera = open && mode !== 'documents';
  useEffect(() => {
    if (!needsCamera) { teardown(); setReady(false); return undefined; }
    let alive = true;
    setError('');
    setReady(false);
    setRecording(false);
    setSeconds(0);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera capture needs a secure (https) context and a supported browser.');
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true })
      .then((stream) => {
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
        setReady(true);
      })
      .catch(() => {
        if (alive) setError('Camera permission was denied or no camera is available — check your browser settings.');
      });
    return () => { alive = false; teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCamera]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `Photo ${new Date().toLocaleTimeString()}.jpg`, { type: 'image/jpeg' });
      onCapture({ file, mimetype: file.type });
      onClose();
    }, 'image/jpeg', 0.92);
  };

  const startVideo = () => {
    if (!streamRef.current) return;
    const mimeType = VIDEO_MIME_CANDIDATES.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      stopTimer();
      const type = (recorder.mimeType || 'video/webm').split(';')[0];
      const blob = new Blob(chunksRef.current, { type });
      const ext = VIDEO_EXT[type] || 'webm';
      const file = new File([blob], `Video ${new Date().toLocaleTimeString()}.${ext}`, { type });
      const dur = seconds;
      onCapture({ file, mimetype: file.type, duration: dur });
      onClose();
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    setRecording(true);
    stopTimer();
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  const stopVideo = () => { try { recorderRef.current?.stop(); } catch { /* noop */ } setRecording(false); };

  const onPickDocuments = (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) {
      onSelectFiles?.(files);
      onClose();
    }
  };

  const seg = (active) => ({
    padding: '6px 14px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
    background: active ? 'var(--primary)' : 'transparent', color: active ? '#fff' : 'var(--text-muted)',
  });

  const TABS = [
    { key: 'photo', label: 'Photo', icon: Camera },
    { key: 'video', label: 'Video', icon: Video },
    { key: 'documents', label: 'Documents', icon: FileText },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Attachment"
      subtitle="Capture a photo or video, or select documents from your device"
      width={560}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}
    >
      <div className="col gap-3">
        {!recording && (
          <div style={{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {TABS.map((t) => (
              <button key={t.key} type="button" style={seg(mode === t.key)} onClick={() => setMode(t.key)}>
                <t.icon size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} /> {t.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'documents' ? (
          <div className="col gap-3 center" style={{ padding: '32px 24px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
            <FileText size={30} style={{ color: 'var(--text-subtle)' }} />
            <span className="sm muted">Select any kind of document to attach — PDF, images, spreadsheets, and more.</span>
            <input ref={fileInputRef} type="file" multiple={multiple} accept={accept} style={{ display: 'none' }} onChange={onPickDocuments} />
            <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} style={{ marginRight: 6 }} /> Select Documents
            </button>
          </div>
        ) : error ? (
          <div className="col gap-2 center" style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
            <RefreshCw size={26} style={{ color: 'var(--text-subtle)' }} />
            <span className="sm" style={{ color: 'var(--danger)' }}>{error}</span>
          </div>
        ) : (
          <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: 360, display: 'block', objectFit: 'contain' }} />
            {recording && (
              <span className="row gap-2" style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '4px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 650, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} /> {fmtDuration(seconds)}
              </span>
            )}
            {!ready && <span className="tiny" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>Starting camera…</span>}
          </div>
        )}

        {mode !== 'documents' && !error && (
          <div className="row gap-2" style={{ justifyContent: 'center' }}>
            {mode === 'photo' ? (
              <button type="button" className="btn btn-primary" disabled={!ready} onClick={takePhoto}>
                <Camera size={15} style={{ marginRight: 6 }} /> Take Photo
              </button>
            ) : recording ? (
              <button type="button" className="btn btn-danger" onClick={stopVideo}>
                <Square size={14} style={{ marginRight: 6 }} /> Stop Recording
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!ready} onClick={startVideo}>
                <Circle size={13} style={{ marginRight: 6, fill: 'currentColor' }} /> Start Recording
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default MediaCaptureModal;
