export interface CompressedImageResult {
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  name: string;
}

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxGifBytes?: number;
  quality?: number;
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

export function formatBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function compressCanvasToDataUrl(
  canvas: HTMLCanvasElement,
  quality = 0.85,
): { dataUrl: string; mime: string } {
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) {
    return { dataUrl: webp, mime: "image/webp" };
  }
  const jpeg = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl: jpeg, mime: "image/jpeg" };
}

export async function compressImageFile(
  file: File,
  options: CompressImageOptions = {},
): Promise<CompressedImageResult> {
  const maxWidth = options.maxWidth ?? 1080;
  const maxHeight = options.maxHeight ?? 1080;
  const maxGifBytes = options.maxGifBytes ?? 900 * 1024;
  const quality = options.quality ?? 0.85;
  const cleanName = (file.name || "image").trim().slice(0, 80) || "image";

  const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
  if (isGif) {
    if (file.size > maxGifBytes) {
      throw new Error(
        `Animated GIF is ${Math.round(file.size / 1024)}KB (max ${Math.round(maxGifBytes / 1024)}KB). Try picking from KLIPY or a smaller GIF!`,
      );
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read GIF file"));
      reader.readAsDataURL(file);
    });
    return {
      dataUrl,
      mime: "image/gif",
      width: 0,
      height: 0,
      bytes: file.size || estimateDataUrlBytes(dataUrl),
      name: cleanName,
    };
  }

  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|bmp|avif)$/i.test(file.name)) {
    throw new Error("Please select an image file (PNG, JPG, WebP, or GIF)");
  }

  const rawUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load selected image"));
      el.src = rawUrl;
    });
    const ratio = Math.min(1, maxWidth / Math.max(1, img.width), maxHeight / Math.max(1, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const { dataUrl, mime } = compressCanvasToDataUrl(canvas, quality);
    return {
      dataUrl,
      mime,
      width: w,
      height: h,
      bytes: estimateDataUrlBytes(dataUrl),
      name: cleanName,
    };
  } finally {
    URL.revokeObjectURL(rawUrl);
  }
}

export async function readImageFileAsDataUrl(
  file: File,
  maxWidth: number,
  maxHeight: number,
  maxGifBytes: number,
): Promise<string> {
  const result = await compressImageFile(file, { maxWidth, maxHeight, maxGifBytes });
  return result.dataUrl;
}

export function isAllowedChatImageUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const s = rawUrl.trim();
  if (/^\/api\/chat\/media\/cimg_[a-zA-Z0-9_-]{4,64}(?:\?[^#]*)?$/.test(s)) {
    return true;
  }
  if (
    s.length <= 450 * 1024 &&
    /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)
  ) {
    return true;
  }
  return false;
}

export async function uploadChatImage(
  dataUrl: string,
  filename = "image",
): Promise<{ imageUrl: string; imageName: string; mime: string; bytes: number }> {
  let authToken = "";
  try {
    authToken = localStorage.getItem("auth_token") || "";
  } catch {}
  if (!authToken) {
    throw new Error("Sign in to CloudSync to upload images");
  }

  const res = await fetch("/api/chat/upload-image", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ dataUrl, filename }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data?.imageUrl) {
    throw new Error(data?.error || `Image upload failed (HTTP ${res.status})`);
  }
  return {
    imageUrl: String(data.imageUrl),
    imageName: String(data.imageName || filename || "image"),
    mime: String(data.mime || "image/webp"),
    bytes: Number(data.bytes) || 0,
  };
}
