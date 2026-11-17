import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  type CompressedImageResult,
  compressCanvasToDataUrl,
  estimateDataUrlBytes,
  formatBytesLabel,
} from "../core/imageUpload.ts";

interface ChatCameraModalProps {
  onAttach: (image: CompressedImageResult) => void;
  onSendNow: (image: CompressedImageResult) => void;
  onFallbackUpload: () => void;
  onClose: () => void;
}

export default function ChatCameraModal({
  onAttach,
  onSendNow,
  onFallbackUpload,
  onClose,
}: ChatCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const camSessionIdRef = useRef(0);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [mirrored, setMirrored] = useState(true);
  const [timerDelaySec, setTimerDelaySec] = useState<0 | 3>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraError, setCameraError] = useState("");
  const [captured, setCaptured] = useState<CompressedImageResult | null>(null);

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
  }, []);

  const stopStream = useCallback(() => {
    camSessionIdRef.current += 1;
    clearCountdown();
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {}
    }
  }, [clearCountdown]);

  const startCamera = useCallback(async () => {
    stopStream();
    const mySessionId = camSessionIdRef.current;
    setCameraError("");
    setLoading(true);

    if (!navigator?.mediaDevices?.getUserMedia) {
      setLoading(false);
      setCameraError(
        window.isSecureContext
          ? "camera API is unavailable in this browser."
          : "camera access requires HTTPS or localhost.",
      );
      return;
    }

    try {
      const videoConstraint: MediaTrackConstraints = selectedDeviceId
        ? {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false,
      });
      if (camSessionIdRef.current !== mySessionId) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (camSessionIdRef.current === mySessionId) {
          setDevices(list.filter((d) => d.kind === "videoinput"));
        }
      } catch {}
    } catch (err: any) {
      if (camSessionIdRef.current !== mySessionId) return;
      const msg = String(err?.name || err?.message || "");
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        setCameraError("camera permission was denied. allow camera access or upload an image file.");
      } else if (msg.includes("NotFound") || msg.includes("DevicesNotFound")) {
        setCameraError("no camera device was found on this computer.");
      } else {
        setCameraError(err?.message || "could not start camera.");
      }
    } finally {
      if (camSessionIdRef.current === mySessionId) {
        setLoading(false);
      }
    }
  }, [facingMode, selectedDeviceId, stopStream]);

  useEffect(() => {
    if (captured) {
      stopStream();
      return;
    }
    void startCamera();
    return () => {
      stopStream();
    };
  }, [captured, startCamera, stopStream]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        stopStream();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, stopStream]);

  const snapFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const maxDim = 1080;
    const ratio = Math.min(1, maxDim / video.videoWidth, maxDim / video.videoHeight);
    const w = Math.max(1, Math.round(video.videoWidth * ratio));
    const h = Math.max(1, Math.round(video.videoHeight * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);

    const { dataUrl, mime } = compressCanvasToDataUrl(canvas, 0.86);
    const ext = mime === "image/webp" ? "webp" : "jpg";
    setCaptured({
      dataUrl,
      mime,
      width: w,
      height: h,
      bytes: estimateDataUrlBytes(dataUrl),
      name: `camera_${Date.now()}.${ext}`,
    });
  }, [mirrored]);

  const handleCaptureClick = () => {
    if (loading || cameraError || countdown !== null) return;
    if (timerDelaySec === 0) {
      snapFrame();
      return;
    }
    let remaining = timerDelaySec;
    setCountdown(remaining);
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        snapFrame();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  };

  const handleFlipCamera = () => {
    if (devices.length > 1) {
      const currentTrackDeviceId =
        selectedDeviceId ||
        streamRef.current?.getVideoTracks?.()[0]?.getSettings?.().deviceId ||
        "";
      const curIdx = devices.findIndex((d) => d.deviceId === currentTrackDeviceId);
      const nextDev = devices[(curIdx + 1) % devices.length];
      if (nextDev?.deviceId) {
        setSelectedDeviceId(nextDev.deviceId);
        return;
      }
    }
    const nextFacing = facingMode === "user" ? "environment" : "user";
    setSelectedDeviceId("");
    setFacingMode(nextFacing);
    setMirrored(nextFacing === "user");
  };

  return (
    <div
      class="chat-profile-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopStream();
          onClose();
        }
      }}
    >
      <div class="chat-camera-modal" onClick={(e) => e.stopPropagation()}>
        <div class="chat-camera-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <i class="fa-solid fa-camera" style={{ color: "#38bdf8" }}></i>
            <span>in-site camera</span>
          </div>
          <button
            type="button"
            class="chat-header-btn"
            title="Close camera"
            onClick={() => {
              stopStream();
              onClose();
            }}
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="chat-camera-stage">
          {captured ? (
            <img
              src={captured.dataUrl}
              alt="Captured photo"
              class="chat-camera-preview-img"
            />
          ) : cameraError ? (
            <div class="chat-camera-error">
              <i class="fa-solid fa-video-slash" style={{ fontSize: "26px", color: "#f87171" }}></i>
              <span>{cameraError}</span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  onClick={() => void startCamera()}
                >
                  <i class="fa-solid fa-rotate-right"></i> try again
                </button>
                <button
                  type="button"
                  class="chat-auth-login-btn"
                  onClick={() => {
                    stopStream();
                    onClose();
                    onFallbackUpload();
                  }}
                >
                  <i class="fa-solid fa-image"></i> upload file instead
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                class={`chat-camera-video${mirrored ? " is-mirrored" : ""}`}
              />
              {loading && (
                <div class="chat-camera-overlay-msg">
                  <i class="fa-solid fa-spinner fa-spin"></i> starting camera...
                </div>
              )}
              {countdown !== null && (
                <div class="chat-camera-countdown">{countdown}</div>
              )}
            </>
          )}
        </div>

        <div class="chat-camera-footer">
          {captured ? (
            <>
              <span class="chat-camera-meta">
                {captured.width}×{captured.height} · {formatBytesLabel(captured.bytes)}
              </span>
              <div class="chat-camera-actions">
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  onClick={() => setCaptured(null)}
                >
                  <i class="fa-solid fa-rotate-left"></i> retake
                </button>
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  onClick={() => {
                    onAttach(captured);
                    onClose();
                  }}
                >
                  <i class="fa-solid fa-paperclip"></i> attach + caption
                </button>
                <button
                  type="button"
                  class="chat-auth-login-btn"
                  onClick={() => {
                    onSendNow(captured);
                    onClose();
                  }}
                >
                  <i class="fa-solid fa-paper-plane"></i> send photo
                </button>
              </div>
            </>
          ) : (
            <>
              <div class="chat-camera-tools">
                <button
                  type="button"
                  class={`chat-gif-more-btn${mirrored ? " active" : ""}`}
                  title="Mirror preview"
                  onClick={() => setMirrored((m) => !m)}
                >
                  <i class="fa-solid fa-left-right"></i> mirror
                </button>
                <button
                  type="button"
                  class={`chat-gif-more-btn${timerDelaySec === 3 ? " active" : ""}`}
                  title="Toggle 3s timer"
                  onClick={() => setTimerDelaySec((t) => (t === 0 ? 3 : 0))}
                >
                  <i class="fa-regular fa-clock"></i> {timerDelaySec === 3 ? "3s timer" : "instant"}
                </button>
                {(devices.length > 1 || !selectedDeviceId) && (
                  <button
                    type="button"
                    class="chat-gif-more-btn"
                    title="Switch camera"
                    onClick={handleFlipCamera}
                  >
                    <i class="fa-solid fa-camera-rotate"></i> flip
                  </button>
                )}
              </div>
              <button
                type="button"
                class="chat-camera-shutter-btn"
                disabled={loading || Boolean(cameraError) || countdown !== null}
                title="Take photo"
                onClick={handleCaptureClick}
              >
                <i class="fa-solid fa-camera"></i>
                <span>{countdown !== null ? `taking in ${countdown}...` : "capture photo"}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
