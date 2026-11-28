import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {frameJpeg} from '../camera-photo.mjs';

export function Camera({onPhoto, onClose}) {
  const dialog = useRef(null), video = useRef(null), taking = useRef(false);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let closed = false, stream;
    dialog.current.showModal();
    async function preview() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error();
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
        if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
      } catch {
        if (!closed) setError('无法打开摄像头，请检查相机权限，或返回后选择图片。');
      }
    }
    void preview();
    return () => { closed = true; stream?.getTracks().forEach(track => track.stop()); };
  }, []);
  async function capture() {
    if (taking.current) return;
    taking.current = true;
    const frame = video.current;
    try {
      const photo = await frameJpeg(frame, frame.videoWidth, frame.videoHeight);
      if (frame.isConnected) { onPhoto(photo); onClose(); }
    } catch {
      if (frame.isConnected) setError('没有拍到照片，请重试。');
    } finally { taking.current = false; }
  }
  return createPortal(<dialog className="photo-camera" ref={dialog} aria-label="拍照提问" onCancel={onClose}>
    <video ref={video} muted playsInline onPlaying={() => setReady(true)} hidden={Boolean(error)} />
    {error && <p role="alert">{error}</p>}
    <div><button type="button" onClick={onClose}>取消</button>
    <button type="button" onClick={capture} disabled={!ready || Boolean(error)}>拍照并提问</button></div>
  </dialog>, document.body);
}
