import { useEffect, useRef, useState } from "preact/hooks";

interface ImageCropModalProps {
  kind: "avatar" | "banner";
  imageSrc: string;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}

/** Interactive drag-and-zoom placement modal for avatar (circle) and banner (wide) uploads. */
export default function ImageCropModal({
  kind,
  imageSrc,
  onApply,
  onCancel,
}: ImageCropModalProps) {
  const frameW = kind === "avatar" ? 240 : 420;
  const frameH = kind === "avatar" ? 240 : 132;
  const outW = kind === "avatar" ? 256 : 720;
  const outH = kind === "avatar" ? 256 : 226;

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const draggingRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setNaturalSize({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => {
      setError("Could not load selected image.");
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const coverScale = naturalSize
    ? Math.max(frameW / naturalSize.w, frameH / naturalSize.h)
    : 1;
  const drawnW = naturalSize ? naturalSize.w * coverScale * zoom : frameW;
  const drawnH = naturalSize ? naturalSize.h * coverScale * zoom : frameH;

  const clampOffset = (x: number, y: number, curZoom = zoom) => {
    if (!naturalSize) return { x: 0, y: 0 };
    const w = naturalSize.w * coverScale * curZoom;
    const h = naturalSize.h * coverScale * curZoom;
    const maxX = Math.max(0, (w - frameW) / 2);
    const maxY = Math.max(0, (h - frameH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  useEffect(() => {
    const onMove = (clientX: number, clientY: number) => {
      const drag = draggingRef.current;
      if (!drag) return;
      const nextX = drag.origX + (clientX - drag.startX);
      const nextY = drag.origY + (clientY - drag.startY);
      setOffset(clampOffset(nextX, nextY));
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onEnd = () => {
      draggingRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchend", onEnd);
    };
  });

  const handleZoomChange = (nextZoom: number) => {
    const clampedZ = Math.max(1, Math.min(3, nextZoom));
    setZoom(clampedZ);
    setOffset((prev) => clampOffset(prev.x, prev.y, clampedZ));
  };

  const handleApplyCrop = () => {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");

      const leftInFrame = (frameW - drawnW) / 2 + offset.x;
      const topInFrame = (frameH - drawnH) / 2 + offset.y;
      const scaleOutX = outW / frameW;
      const scaleOutY = outH / frameH;

      ctx.drawImage(
        img,
        leftInFrame * scaleOutX,
        topInFrame * scaleOutY,
        drawnW * scaleOutX,
        drawnH * scaleOutY
      );

      let finalUrl = "";
      for (const q of [0.88, 0.72, 0.56]) {
        const webp = canvas.toDataURL("image/webp", q);
        const candidate =
          webp.length > 32 && webp.startsWith("data:image/webp")
            ? webp
            : canvas.toDataURL("image/jpeg", q);
        finalUrl = candidate;
        if (candidate.length <= 420_000) break;
      }
      if (!finalUrl || finalUrl.length > 445_000) {
        finalUrl = canvas.toDataURL("image/jpeg", 0.42);
      }
      onApply(finalUrl);
    } catch (err) {
      setError((err as Error).message || "Failed to crop image");
    }
  };

  return (
    <div
      class="chat-crop-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div class="chat-crop-modal" onClick={(e) => e.stopPropagation()}>
        <div class="chat-crop-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <i class="fa-solid fa-crop-simple" style={{ color: "#c084fc" }} />
            <span>
              adjust {kind === "avatar" ? "profile picture" : "banner"} placement
            </span>
          </div>
          <button
            type="button"
            class="chat-header-btn"
            onClick={onCancel}
            title="Cancel crop"
          >
            <i class="fa-solid fa-xmark" />
          </button>
        </div>

        <div class="chat-crop-stage-wrap">
          {error ? (
            <div style={{ color: "#fca5a5", fontSize: "12px" }}>{error}</div>
          ) : (
            <div
              class={`chat-crop-viewport ${kind === "avatar" ? "is-circle" : "is-banner"}`}
              style={{ width: `${frameW}px`, height: `${frameH}px` }}
              onMouseDown={(e) => {
                e.preventDefault();
                draggingRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: offset.x,
                  origY: offset.y,
                };
              }}
              onTouchStart={(e) => {
                if (!e.touches[0]) return;
                draggingRef.current = {
                  startX: e.touches[0].clientX,
                  startY: e.touches[0].clientY,
                  origX: offset.x,
                  origY: offset.y,
                };
              }}
            >
              {naturalSize && (
                <img
                  src={imageSrc}
                  alt="Crop preview"
                  draggable={false}
                  style={{
                    width: `${drawnW}px`,
                    height: `${drawnH}px`,
                    left: `${(frameW - drawnW) / 2 + offset.x}px`,
                    top: `${(frameH - drawnH) / 2 + offset.y}px`,
                  }}
                />
              )}
              <div class="chat-crop-guide" aria-hidden="true" />
            </div>
          )}
          <div class="chat-crop-hint">
            drag image to reposition · use slider to zoom inside frame
          </div>
        </div>

        <div class="chat-crop-controls">
          <i class="fa-solid fa-magnifying-glass-minus" style={{ opacity: 0.7 }} />
          <input
            type="range"
            min="1"
            max="3"
            step="0.02"
            value={zoom}
            class="chat-crop-zoom-slider"
            aria-label="Zoom image"
            onInput={(e) =>
              handleZoomChange(parseFloat((e.target as HTMLInputElement).value))
            }
          />
          <i class="fa-solid fa-magnifying-glass-plus" style={{ opacity: 0.7 }} />
          <span class="chat-crop-zoom-val">{zoom.toFixed(1)}x</span>
        </div>

        <div class="chat-crop-actions">
          <button
            type="button"
            class="chat-gif-more-btn"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            center & reset
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" class="chat-gif-more-btn" onClick={onCancel}>
              cancel
            </button>
            <button
              type="button"
              class="chat-header-btn"
              disabled={!naturalSize || Boolean(error)}
              style={{
                backgroundColor: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
                fontWeight: 600,
              }}
              onClick={handleApplyCrop}
            >
              apply placement
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
