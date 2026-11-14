/**
 * Sunshine Live Client & Chaos Receiver
 * Connects to Sunshine SSE channel for live status and remote administration / sound effects / trolls.
 */

// Global AudioContext for synthesized effects
let audioCtx: AudioContext | null = null;
let audioUnlocked = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

function unlockAudio(): void {
  if (audioUnlocked) return;
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    void ctx.resume().then(() => {
      audioUnlocked = true;
    });
  } else {
    audioUnlocked = true;
  }
}

// Unlock audio on first user gesture
if (typeof window !== "undefined") {
  window.addEventListener("click", unlockAudio, { once: true, passive: true });
  window.addEventListener("keydown", unlockAudio, { once: true, passive: true });
  window.addEventListener("touchstart", unlockAudio, { once: true, passive: true });
}

// --- Synthesized Sound Effects (Zero External Dependencies) ---

export function playVineBoom(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Sub Bass Oscillator with steep pitch drop
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(25, now + 0.85);

    // Waveshaper distortion for that deep 808 rumble
    const distortion = ctx.createWaveShaper();
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * 3.5);
    }
    distortion.curve = curve;

    // Punch transient noise burst
    const bufferSize = ctx.sampleRate * 0.12;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    oscGain.gain.setValueAtTime(1.0, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(distortion);
    distortion.connect(oscGain);
    oscGain.connect(ctx.destination);

    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    osc.start(now);
    noise.start(now);
    osc.stop(now + 1.25);
    noise.stop(now + 0.15);
  } catch (err) {
    console.warn("Failed to play vine boom:", err);
  }
}

export function playDiscordPing(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Two rapid sine pings (660Hz and 880Hz)
    const notes = [
      { freq: 659.25, time: now, dur: 0.12 },
      { freq: 880.0, time: now + 0.08, dur: 0.22 },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, note.time);

      gain.gain.setValueAtTime(0.6, note.time);
      gain.gain.exponentialRampToValueAtTime(0.001, note.time + note.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(note.time);
      osc.stop(note.time + note.dur);
    }
  } catch (err) {
    console.warn("Failed to play discord ping:", err);
  }
}

export function playMetalPipe(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Metallic inharmonic frequencies
    const freqs = [380, 720, 1260, 2180, 3100, 4200];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? "sawtooth" : "square";
      osc.frequency.setValueAtTime(freqs[i], now);
      // Slight pitch wobble for reverberant hollow pipe sound
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.92, now + 1.8);

      const decayTime = 0.8 + i * 0.25;
      gain.gain.setValueAtTime(0.18 / (i + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

      // Highpass to eliminate mud and enhance clatter
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(400, now);

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + decayTime);
    }

    // Impact noise burst
    const bufferSize = ctx.sampleRate * 0.3;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.6, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.3);
  } catch (err) {
    console.warn("Failed to play metal pipe:", err);
  }
}

export function playWindowsUsb(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    // USB Disconnect sound: E5 -> C5
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.5, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(523.25, now + 0.16);
    gain2.gain.setValueAtTime(0.5, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.16);
    osc2.stop(now + 0.4);
  } catch (err) {
    console.warn("Failed to play usb disconnect:", err);
  }
}

export function playDoorKnock(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // 3 quick wooden knuckle knocks spaced 130ms apart
    for (let knock = 0; knock < 3; knock++) {
      const kTime = now + knock * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(180, kTime);
      osc.frequency.exponentialRampToValueAtTime(70, kTime + 0.08);

      filter.type = "bandpass";
      filter.frequency.setValueAtTime(320, kTime);
      filter.Q.setValueAtTime(4, kTime);

      gain.gain.setValueAtTime(0.9, kTime);
      gain.gain.exponentialRampToValueAtTime(0.001, kTime + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(kTime);
      osc.stop(kTime + 0.09);
    }
  } catch (err) {
    console.warn("Failed to play door knock:", err);
  }
}

export function playBruh(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Vocal formant synthesizer for deep "bruh" inflection
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();

    osc.type = "sawtooth";
    // Pitch inflects down from 110Hz to 65Hz
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.45);

    f1.type = "bandpass";
    f1.frequency.setValueAtTime(450, now);
    f1.Q.setValueAtTime(4, now);

    f2.type = "bandpass";
    f2.frequency.setValueAtTime(800, now);
    f2.Q.setValueAtTime(4, now);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc.connect(f1);
    osc.connect(f2);
    f1.connect(gain);
    f2.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.55);
  } catch (err) {
    console.warn("Failed to play bruh:", err);
  }
}

export function playFart(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Fluttering low frequency saw
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(75, now);
    osc.frequency.linearRampToValueAtTime(40, now + 0.4);

    // Modulate pitch with rapid jitter
    const jitter = ctx.createOscillator();
    const jitterGain = ctx.createGain();
    jitter.frequency.setValueAtTime(28, now);
    jitterGain.gain.setValueAtTime(35, now);
    jitter.connect(osc.frequency);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(380, now);
    filter.Q.setValueAtTime(5, now);

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    jitter.start(now);
    osc.start(now);
    jitter.stop(now + 0.5);
    osc.stop(now + 0.5);
  } catch (err) {
    console.warn("Failed to play fart:", err);
  }
}

export function playKeyboardClatter(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Burst of 10 mechanical keyboard switch clicks
    for (let i = 0; i < 10; i++) {
      const cTime = now + i * 0.045 + (Math.random() * 0.02);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = "square";
      osc.frequency.setValueAtTime(2800 + Math.random() * 1200, cTime);

      filter.type = "highpass";
      filter.frequency.setValueAtTime(1500, cTime);

      gain.gain.setValueAtTime(0.35, cTime);
      gain.gain.exponentialRampToValueAtTime(0.001, cTime + 0.03);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(cTime);
      osc.stop(cTime + 0.035);
    }
  } catch (err) {
    console.warn("Failed to play keyboard clatter:", err);
  }
}

export function playScreamer(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "square";

    osc1.frequency.setValueAtTime(900, now);
    osc1.frequency.linearRampToValueAtTime(2600, now + 0.35);

    osc2.frequency.setValueAtTime(950, now);
    osc2.frequency.linearRampToValueAtTime(2750, now + 0.35);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.5);
    osc2.stop(now + 0.5);
  } catch (err) {
    console.warn("Failed to play screamer:", err);
  }
}

export function playXpError(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    // Dissonant brassy error hit: C3, D#3, F#3
    const freqs = [130.81, 155.56, 185.0, 261.63];
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.65);
    }
  } catch (err) {
    console.warn("Failed to play xp error:", err);
  }
}

export function playRickroll(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    // "Never Gonna Give You Up" intro chip melody
    // Notes: F4, G4, Bb4, G4, D5, D5, C5, F4, G4, Bb4, G4, C5, C5, Bb4, A4, G4
    const melody: [number, number][] = [
      [349.23, 0.15],
      [392.0, 0.15],
      [466.16, 0.2],
      [392.0, 0.18],
      [587.33, 0.35],
      [587.33, 0.3],
      [523.25, 0.5],
    ];

    let t = now;
    for (const [freq, dur] of melody) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.05;
    }
  } catch (err) {
    console.warn("Failed to play rickroll:", err);
  }
}

const PRESET_MAP: Record<string, string> = {
  "https://www.myinstants.com/media/sounds/vine-boom.mp3": "/assets/sounds/vine-boom.mp3",
  "https://www.myinstants.com/media/sounds/movie_1.mp3": "/assets/sounds/bruh.mp3",
  "https://www.myinstants.com/media/sounds/metal-pipe-falling-sound-effect.mp3": "/assets/sounds/metal-pipe.mp3",
  "https://www.myinstants.com/media/sounds/discord-notification.mp3": "/assets/sounds/discord-ping.mp3",
  "https://www.myinstants.com/media/sounds/fart-with-reverb.mp3": "/assets/sounds/reverb-fart.mp3",
  "https://www.myinstants.com/media/sounds/taco-bell-bong-sfx.mp3": "/assets/sounds/taco-bell.mp3",
  "https://www.myinstants.com/media/sounds/fbi-open-up_mI4PDIx.mp3": "/assets/sounds/fbi-open-up.mp3",
  "https://www.myinstants.com/media/sounds/mlg-airhorn.mp3": "/assets/sounds/airhorn.mp3",
  "https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3": "/assets/sounds/emotional-damage.mp3",
  "https://www.myinstants.com/media/sounds/windows-xp-error.mp3": "/assets/sounds/xp-error.mp3",
  "https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3": "/assets/sounds/roblox-oof.mp3",
  "https://www.myinstants.com/media/sounds/sad-violin.mp3": "/assets/sounds/sad-violin.mp3",
  "https://www.myinstants.com/media/sounds/what-da-dog-doin.mp3": "/assets/sounds/what-da-dog.mp3",
  "https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3": "/assets/sounds/run-meme.mp3",
  "https://www.myinstants.com/media/sounds/knocking-on-door_1.mp3": "/assets/sounds/door-knock.mp3",
  "https://www.myinstants.com/media/sounds/rick-roll.mp3": "/assets/sounds/rickroll.mp3",
  "https://www.myinstants.com/media/sounds/screamer-sound.mp3": "/assets/sounds/screamer.mp3",
  "https://www.myinstants.com/media/sounds/snore-mimimi.mp3": "/assets/sounds/snore-mimimi.mp3",
};

export function normalizeSoundUrl(url: string): string {
  if (!url) return "/assets/sounds/vine-boom.mp3";
  if (url === "/assets/sounds/fart-reverb.mp3") return "/assets/sounds/reverb-fart.mp3";
  if (url === "/assets/sounds/goofy-ahh.mp3") return "/assets/sounds/what-da-dog.mp3";
  if (PRESET_MAP[url]) return PRESET_MAP[url];
  if (url.startsWith("/api/live/audio-proxy?url=")) {
    try {
      const inner = decodeURIComponent(url.split("url=")[1] || "");
      if (PRESET_MAP[inner]) return PRESET_MAP[inner];
    } catch {}
  }
  return url;
}

function playFallbackSynthForUrl(url: string): void {
  const lower = (url || "").toLowerCase();
  if (lower.includes("pipe")) playMetalPipe();
  else if (lower.includes("fart")) playFart();
  else if (lower.includes("discord") || lower.includes("ping")) playDiscordPing();
  else if (lower.includes("knock") || lower.includes("fbi")) playDoorKnock();
  else if (lower.includes("bruh") || lower.includes("emotional") || lower.includes("dog")) playBruh();
  else if (lower.includes("xp") || lower.includes("error") || lower.includes("oof")) playXpError();
  else if (lower.includes("rick") || lower.includes("violin")) playRickroll();
  else if (lower.includes("scream") || lower.includes("airhorn") || lower.includes("run")) playScreamer();
  else playVineBoom();
}

const blobAudioCache = new Map<string, string>();

async function resolvePlayableUrl(url: string): Promise<string> {
  const norm = normalizeSoundUrl(url);
  if (
    norm.startsWith("/assets/sounds/") ||
    norm.startsWith("/custom-sounds/") ||
    norm.startsWith("data:audio") ||
    norm.startsWith("blob:")
  ) {
    return norm;
  }

  let rawExternal = norm;
  if (norm.startsWith("/api/live/audio-proxy?url=")) {
    try {
      rawExternal = decodeURIComponent(norm.split("url=")[1] || "");
    } catch {}
  }

  const cachedBlob = blobAudioCache.get(rawExternal);
  if (cachedBlob) return cachedBlob;

  // 1. Try local backend audio-proxy first
  try {
    const proxyUrl = `/api/live/audio-proxy?url=${encodeURIComponent(rawExternal)}`;
    const res = await fetch(proxyUrl);
    const ct = res.headers.get("content-type") || "";
    if (res.ok && !ct.includes("text/html")) {
      const buf = await res.arrayBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      blobAudioCache.set(rawExternal, blobUrl);
      return blobUrl;
    }
  } catch {}

  // 2. Fallback to CORS proxy blob if server hasn't restarted yet
  try {
    const fallbackRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(rawExternal)}`);
    if (fallbackRes.ok) {
      const buf = await fallbackRes.arrayBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      blobAudioCache.set(rawExternal, blobUrl);
      return blobUrl;
    }
  } catch {}

  return norm;
}

export function playAudioUrl(url: string, volume = 1.0): void {
  unlockAudio();
  void resolvePlayableUrl(url)
    .then((playableUrl) => {
      const audio = new Audio(playableUrl);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.onerror = () => {
        playFallbackSynthForUrl(url);
      };
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("Audio element play error, falling back to synth:", err);
          playFallbackSynthForUrl(url);
        });
      }
    })
    .catch((err) => {
      console.warn("Failed to resolve audio for url, falling back to synth:", url, err);
      playFallbackSynthForUrl(url);
    });
}

export function playSfxByName(nameOrUrl: string, volume = 1.0): void {
  unlockAudio();
  if (
    nameOrUrl.startsWith("http://") ||
    nameOrUrl.startsWith("https://") ||
    nameOrUrl.startsWith("/assets/sounds/") ||
    nameOrUrl.startsWith("/custom-sounds/") ||
    nameOrUrl.startsWith("/api/live/audio-proxy") ||
    nameOrUrl.startsWith("data:audio")
  ) {
    playAudioUrl(nameOrUrl, volume);
    return;
  }
  switch (nameOrUrl) {
    case "vine-boom":
      playVineBoom();
      break;
    case "discord-ping":
      playDiscordPing();
      break;
    case "metal-pipe":
      playMetalPipe();
      break;
    case "windows-usb":
      playWindowsUsb();
      break;
    case "door-knock":
      playDoorKnock();
      break;
    case "bruh":
      playBruh();
      break;
    case "fart":
      playFart();
      break;
    case "keyboard-clatter":
      playKeyboardClatter();
      break;
    case "screamer":
      playScreamer();
      break;
    case "xp-error":
      playXpError();
      break;
    case "rickroll":
      playRickroll();
      break;
    default:
      playVineBoom();
      break;
  }
}

// --- Text-To-Speech (Voice of God) ---

export function speakTts(text: string, pitch = 1.0, rate = 1.0, volume = 1.0): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = Math.max(0.1, Math.min(2.0, pitch));
    utterance.rate = Math.max(0.1, Math.min(2.0, rate));
    utterance.volume = Math.max(0.1, Math.min(1.0, volume));
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("TTS speak failed:", err);
  }
}

// --- Visual Pranks & Chaos Controller ---

let originalTitle: string | null = null;
let titleFlashTimer: number | null = null;
let ghostCursorTimer: number | null = null;
let matrixAnimFrame: number | null = null;
let dvdAnimFrame: number | null = null;

function ensureChaosStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("cookie-chaos-runtime-styles")) return;
  const style = document.createElement("style");
  style.id = "cookie-chaos-runtime-styles";
  style.textContent = `
    @keyframes cookieChaosQuake {
      0%, 100% { transform: translate(0, 0) rotate(0deg); }
      15% { transform: translate(-12px, -8px) rotate(-1.5deg); }
      30% { transform: translate(12px, 8px) rotate(1.5deg); }
      45% { transform: translate(-10px, 10px) rotate(-1deg); }
      60% { transform: translate(10px, -10px) rotate(1deg); }
      75% { transform: translate(-8px, 6px) rotate(-1.2deg); }
      90% { transform: translate(8px, -6px) rotate(1.2deg); }
    }
    @keyframes cookieChaosBarrelRoll {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes cookieChaosDisco {
      0% { background: rgba(239, 68, 68, 0.32); backdrop-filter: hue-rotate(0deg); }
      20% { background: rgba(234, 179, 8, 0.32); backdrop-filter: hue-rotate(72deg); }
      40% { background: rgba(34, 197, 94, 0.32); backdrop-filter: hue-rotate(144deg); }
      60% { background: rgba(59, 130, 246, 0.32); backdrop-filter: hue-rotate(216deg); }
      80% { background: rgba(168, 85, 247, 0.32); backdrop-filter: hue-rotate(288deg); }
      100% { background: rgba(236, 72, 153, 0.32); backdrop-filter: hue-rotate(360deg); }
    }
    body.cookie-chaos-earthquake {
      animation: cookieChaosQuake 0.14s infinite !important;
    }
    html.cookie-chaos-barrel-roll {
      animation: cookieChaosBarrelRoll 1.6s cubic-bezier(0.4, 0, 0.2, 1) 1 !important;
    }
    html.cookie-chaos-flipped {
      transform: rotate(180deg) !important;
      transition: transform 0.45s ease !important;
    }
    html.cookie-chaos-invert {
      filter: invert(1) hue-rotate(180deg) !important;
    }
    html.cookie-chaos-blur {
      filter: blur(4px) !important;
    }
  `;
  document.head.appendChild(style);
}

export function applyChaosEffect(effect: string, data?: Record<string, unknown>): void {
  ensureChaosStyles();
  const duration = typeof data?.duration === "number" ? data.duration : 0;

  switch (effect) {
    case "barrel-roll": {
      document.documentElement.classList.remove("cookie-chaos-barrel-roll");
      void document.documentElement.offsetWidth;
      document.documentElement.classList.add("cookie-chaos-barrel-roll");
      window.setTimeout(() => {
        document.documentElement.classList.remove("cookie-chaos-barrel-roll");
      }, duration > 0 ? duration : 1700);
      break;
    }

    case "earthquake": {
      document.body.classList.add("cookie-chaos-earthquake");
      const dur = duration || 6000;
      window.setTimeout(() => {
        document.body.classList.remove("cookie-chaos-earthquake");
      }, dur);
      break;
    }

    case "flip":
    case "screen-flip": {
      if (duration > 0) {
        document.documentElement.classList.add("cookie-chaos-flipped");
        window.setTimeout(() => {
          document.documentElement.classList.remove("cookie-chaos-flipped");
        }, duration);
      } else {
        document.documentElement.classList.toggle("cookie-chaos-flipped");
      }
      break;
    }

    case "disco": {
      let overlay = document.getElementById("cookie-disco-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "cookie-disco-overlay";
        overlay.style.cssText =
          "position:fixed;inset:0;z-index:2147483640;pointer-events:none;animation:cookieChaosDisco 0.45s linear infinite;";
        document.body.appendChild(overlay);
      }
      const dur = duration || 7000;
      window.setTimeout(() => {
        overlay?.remove();
      }, dur);
      break;
    }

    case "dvd-bounce": {
      let dvd = document.getElementById("cookie-dvd-bouncer");
      if (!dvd) {
        dvd = document.createElement("div");
        dvd.id = "cookie-dvd-bouncer";
        dvd.style.cssText =
          "position:fixed;top:0;left:0;width:150px;height:74px;z-index:2147483641;pointer-events:none;border-radius:16px;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;font-weight:900;font-size:28px;letter-spacing:2px;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,0.55);border:2px solid rgba(255,255,255,0.5);";
        dvd.textContent = "COOKIE DVD";
        document.body.appendChild(dvd);
      }
      const colors = ["#ef4444", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
      let colorIdx = 0;
      dvd.style.backgroundColor = colors[colorIdx];
      let x = Math.random() * Math.max(100, window.innerWidth - 180);
      let y = Math.random() * Math.max(100, window.innerHeight - 100);
      let vx = 5.2;
      let vy = 4.4;

      if (dvdAnimFrame) cancelAnimationFrame(dvdAnimFrame);
      const stepDvd = () => {
        const el = document.getElementById("cookie-dvd-bouncer");
        if (!el) return;
        x += vx;
        y += vy;
        let bounced = false;
        if (x <= 0 || x + 150 >= window.innerWidth) {
          vx *= -1;
          bounced = true;
        }
        if (y <= 0 || y + 74 >= window.innerHeight) {
          vy *= -1;
          bounced = true;
        }
        if (bounced) {
          colorIdx = (colorIdx + 1) % colors.length;
          el.style.backgroundColor = colors[colorIdx];
          document.body.style.transform = `translate(${vx * 1.4}px, ${vy * 1.4}px)`;
          window.setTimeout(() => {
            document.body.style.transform = "";
          }, 90);
        }
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        dvdAnimFrame = requestAnimationFrame(stepDvd);
      };
      dvdAnimFrame = requestAnimationFrame(stepDvd);

      const dur = duration || 10000;
      window.setTimeout(() => {
        if (dvdAnimFrame) {
          cancelAnimationFrame(dvdAnimFrame);
          dvdAnimFrame = null;
        }
        document.body.style.transform = "";
        document.getElementById("cookie-dvd-bouncer")?.remove();
      }, dur);
      break;
    }

    case "bsod": {
      let bsod = document.getElementById("cookie-fake-bsod");
      if (!bsod) {
        bsod = document.createElement("div");
        bsod.id = "cookie-fake-bsod";
        bsod.style.cssText =
          "position:fixed;inset:0;z-index:2147483646;background:#0078d7;color:#ffffff;font-family:'Segoe UI',system-ui,sans-serif;padding:10vh 12vw;display:flex;flex-direction:column;justify-content:center;cursor:none;user-select:none;";
        bsod.innerHTML = `
          <div style="font-size:96px;line-height:1;margin-bottom:24px;">:(</div>
          <div style="font-size:26px;font-weight:300;max-width:760px;line-height:1.45;margin-bottom:28px;">
            Your PC ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you.
          </div>
          <div style="font-size:24px;font-weight:300;margin-bottom:36px;">
            <span id="cookie-bsod-pct">15</span>% complete
          </div>
          <div style="font-size:14px;opacity:0.85;line-height:1.6;">
            Stop code: COOKIE_TROLL_KERNEL_EXCEPTION<br/>
            Click anywhere or wait a few seconds to dismiss
          </div>
        `;
        bsod.addEventListener("click", () => bsod?.remove());
        document.body.appendChild(bsod);
      }
      playXpError();
      const dur = duration || 5000;
      window.setTimeout(() => {
        document.getElementById("cookie-fake-bsod")?.remove();
      }, dur);
      break;
    }

    case "dead-pixel": {
      let pixel = document.getElementById("cookie-dead-pixel");
      if (!pixel) {
        pixel = document.createElement("div");
        pixel.id = "cookie-dead-pixel";
        document.body.appendChild(pixel);
      }
      const x = Math.floor(20 + Math.random() * 60);
      const y = Math.floor(20 + Math.random() * 60);
      pixel.style.top = `${y}vh`;
      pixel.style.left = `${x}vw`;
      break;
    }

    case "eyelash": {
      let eyelash = document.getElementById("cookie-eyelash");
      if (!eyelash) {
        eyelash = document.createElement("div");
        eyelash.id = "cookie-eyelash";
        eyelash.innerHTML = `
          <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M 4 2 Q 18 16 28 32 Q 33 40 37 44" stroke="#1c1c1c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M 4 2 Q 17 15 27 30 Q 32 38 36 43" stroke="#2b2b2b" stroke-width="0.8" stroke-linecap="round" />
          </svg>
        `;
        document.body.appendChild(eyelash);
      }
      const top = Math.floor(15 + Math.random() * 70);
      const left = Math.floor(15 + Math.random() * 70);
      const rot = Math.floor(Math.random() * 360);
      eyelash.style.top = `${top}vh`;
      eyelash.style.left = `${left}vw`;
      eyelash.style.transform = `rotate(${rot}deg)`;
      break;
    }

    case "fake-battery": {
      let banner = document.getElementById("cookie-fake-battery");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "cookie-fake-battery";
        banner.innerHTML = `
          <div class="battery-icon">🪫</div>
          <div class="battery-info">
            <div class="battery-title">Battery critically low (3%)</div>
            <div class="battery-desc">Plug in your PC immediately or it will automatically shut down.</div>
          </div>
          <button class="battery-close" onclick="this.closest('#cookie-fake-battery').remove()">✕</button>
        `;
        document.body.appendChild(banner);
      }
      break;
    }

    case "admin-monitor": {
      let banner = document.getElementById("cookie-admin-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "cookie-admin-banner";
        const adminName = (data?.from as string) || "bacon";
        banner.innerHTML = `
          <span class="pulse-dot"></span>
          <span>⚠️ <strong>SECURITY ALERT:</strong> Session is being monitored in real-time by Administrator (${adminName}). All activities are logged.</span>
        `;
        document.body.appendChild(banner);
      }
      break;
    }

    case "panic-doc": {
      let doc = document.getElementById("cookie-panic-doc");
      if (!doc) {
        doc = document.createElement("div");
        doc.id = "cookie-panic-doc";
        doc.innerHTML = `
          <div class="panic-toolbar">
            <div class="panic-title">AP History Research Essay - Google Docs</div>
            <div class="panic-menu">File &nbsp; Edit &nbsp; View &nbsp; Insert &nbsp; Format &nbsp; Tools &nbsp; Extensions &nbsp; Help</div>
          </div>
          <div class="panic-doc-page">
            <h2>The Economic Ramifications of the Second Industrial Revolution</h2>
            <p><strong>Abstract:</strong> The transition from steam-powered manufacturing to electrical and chemical-based production systems radically transformed modern labor distribution, urban centralization, and global capital flow.</p>
            <p>During the late nineteenth century, the emergence of standardized interchangeable components and high-throughput rail transportation networks created an unprecedented reduction in marginal logistics costs...</p>
            <p>Furthermore, the consolidation of financial monopolies necessitated modern legislative interventions including antitrust regulations and labor protections.</p>
          </div>
          <div class="panic-hint">Press <strong>ESC</strong> or Click to dismiss disguise</div>
        `;
        doc.addEventListener("click", () => doc?.remove());
        document.addEventListener("keydown", function escHandler(e) {
          if (e.key === "Escape") {
            doc?.remove();
            document.removeEventListener("keydown", escHandler);
          }
        });
        document.body.appendChild(doc);
      }
      break;
    }

    case "ghost-cursor": {
      let cursor = document.getElementById("cookie-ghost-cursor");
      if (!cursor) {
        cursor = document.createElement("div");
        cursor.id = "cookie-ghost-cursor";
        cursor.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 2L20 12L12 14L8 22L4 2Z" fill="white" stroke="black" stroke-width="1.8"/>
          </svg>
        `;
        document.body.appendChild(cursor);
      }

      if (ghostCursorTimer) window.clearInterval(ghostCursorTimer);
      let curX = window.innerWidth / 2;
      let curY = window.innerHeight / 2;
      ghostCursorTimer = window.setInterval(() => {
        curX += (Math.random() - 0.5) * 180;
        curY += (Math.random() - 0.5) * 180;
        curX = Math.max(10, Math.min(window.innerWidth - 30, curX));
        curY = Math.max(10, Math.min(window.innerHeight - 30, curY));
        if (cursor) {
          cursor.style.transform = `translate3d(${curX}px, ${curY}px, 0)`;
        }
      }, 120);
      if (duration > 0) {
        window.setTimeout(() => {
          if (ghostCursorTimer) {
            window.clearInterval(ghostCursorTimer);
            ghostCursorTimer = null;
          }
          document.getElementById("cookie-ghost-cursor")?.remove();
        }, duration);
      }
      break;
    }

    case "flash-title": {
      if (!originalTitle) originalTitle = document.title;
      if (titleFlashTimer) window.clearInterval(titleFlashTimer);
      let state = false;
      titleFlashTimer = window.setInterval(() => {
        state = !state;
        document.title = state ? "⚠️ (1) ADMIN VIOLATION DETECTED" : "🚨 FBI OPEN UP";
      }, 800);
      break;
    }

    case "invert-colors": {
      if (duration > 0) {
        document.documentElement.classList.add("cookie-chaos-invert");
        window.setTimeout(() => {
          document.documentElement.classList.remove("cookie-chaos-invert");
        }, duration);
      } else {
        document.documentElement.classList.toggle("cookie-chaos-invert");
      }
      break;
    }

    case "blur": {
      if (duration > 0) {
        document.documentElement.classList.add("cookie-chaos-blur");
        window.setTimeout(() => {
          document.documentElement.classList.remove("cookie-chaos-blur");
        }, duration);
      } else {
        document.documentElement.classList.toggle("cookie-chaos-blur");
      }
      break;
    }

    case "matrix-rain": {
      let canvas = document.getElementById("cookie-matrix-canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "cookie-matrix-canvas";
        canvas.style.cssText = "position:fixed;inset:0;z-index:2147483639;pointer-events:none;opacity:0.78;";
        document.body.appendChild(canvas);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) break;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const katakana = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテト";
      const fontSize = 16;
      const columns = Math.floor(canvas.width / fontSize);
      const drops: number[] = [];
      for (let i = 0; i < columns; i++) {
        drops[i] = Math.random() * -50;
      }

      const drawMatrix = () => {
        ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
        ctx.fillRect(0, 0, canvas!.width, canvas!.height);
        ctx.fillStyle = "#00ff66";
        ctx.font = `${fontSize}px monospace`;

        for (let i = 0; i < drops.length; i++) {
          const text = katakana.charAt(Math.floor(Math.random() * katakana.length));
          ctx.fillText(text, i * fontSize, drops[i] * fontSize);
          if (drops[i] * fontSize > canvas!.height && Math.random() > 0.975) {
            drops[i] = 0;
          }
          drops[i]++;
        }
        matrixAnimFrame = requestAnimationFrame(drawMatrix);
      };
      if (matrixAnimFrame) cancelAnimationFrame(matrixAnimFrame);
      matrixAnimFrame = requestAnimationFrame(drawMatrix);
      if (duration > 0) {
        window.setTimeout(() => {
          if (matrixAnimFrame) {
            cancelAnimationFrame(matrixAnimFrame);
            matrixAnimFrame = null;
          }
          document.getElementById("cookie-matrix-canvas")?.remove();
        }, duration);
      }
      break;
    }

    default:
      break;
  }
}

export function clearChaosEffects(): void {
  // Remove CSS classes
  document.body.classList.remove("cookie-chaos-earthquake");
  document.body.style.transform = "";
  document.documentElement.classList.remove(
    "cookie-chaos-barrel-roll",
    "cookie-chaos-flipped",
    "cookie-chaos-invert",
    "cookie-chaos-blur"
  );

  // Remove DOM elements
  const ids = [
    "cookie-dead-pixel",
    "cookie-eyelash",
    "cookie-fake-battery",
    "cookie-admin-banner",
    "cookie-panic-doc",
    "cookie-ghost-cursor",
    "cookie-matrix-canvas",
    "cookie-disco-overlay",
    "cookie-dvd-bouncer",
    "cookie-fake-bsod",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // Clear timers
  if (titleFlashTimer) {
    window.clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  if (originalTitle) {
    document.title = originalTitle;
    originalTitle = null;
  }
  if (ghostCursorTimer) {
    window.clearInterval(ghostCursorTimer);
    ghostCursorTimer = null;
  }
  if (matrixAnimFrame) {
    cancelAnimationFrame(matrixAnimFrame);
    matrixAnimFrame = null;
  }
  if (dvdAnimFrame) {
    cancelAnimationFrame(dvdAnimFrame);
    dvdAnimFrame = null;
  }

  // Cancel any TTS speech
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

const executedTrollEventIds = new Set<string>();

export function executeTrollAction(
  action: string,
  data?: Record<string, unknown>,
  trollEventId?: string
): void {
  if (trollEventId) {
    if (executedTrollEventIds.has(trollEventId)) return;
    executedTrollEventIds.add(trollEventId);
    if (executedTrollEventIds.size > 200) {
      const first = executedTrollEventIds.values().next().value;
      if (first) executedTrollEventIds.delete(first);
    }
  }

  if (action === "sfx") {
    const url = data?.url as string | undefined;
    const vol = typeof data?.volume === "number" ? data.volume : 1.0;
    if (url) {
      playAudioUrl(url, vol);
    } else {
      playSfxByName((data?.sound as string) || "vine-boom", vol);
    }
  } else if (action === "tts") {
    speakTts(
      (data?.text as string) || "Hello from Cookie Shop!",
      typeof data?.pitch === "number" ? data.pitch : 1.0,
      typeof data?.rate === "number" ? data.rate : 1.0,
      typeof data?.volume === "number" ? data.volume : 1.0
    );
  } else if (action === "effect") {
    applyChaosEffect((data?.effect as string) || "earthquake", data);
  } else if (action === "clear") {
    clearChaosEffects();
  }
}

// --- Live Client Registration & SSE Connection ---

let currentClientId: string | null = null;
let currentUsername: string = "Guest";
let eventSource: EventSource | null = null;
let heartbeatInterval: number | null = null;
let activeGameTitleTracked: string = "";
let activeGameStartedAtMs: number = 0;

export function getClientId(): string {
  if (currentClientId) return currentClientId;
  let id = localStorage.getItem("sunshine_live_id");
  if (!id) {
    id = Math.random().toString(36).substring(2, 11);
    localStorage.setItem("sunshine_live_id", id);
  }
  currentClientId = id;
  return id;
}

export function getActiveUsername(): string {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.username) return parsed.username;
    }
    const g = localStorage.getItem("cookie_guest_name");
    if (g) return g;
  } catch {
    // fallback
  }
  const fallback = "guest_" + getClientId().substring(0, 4);
  try {
    localStorage.setItem("cookie_guest_name", fallback);
  } catch {}
  return fallback;
}

export function detectCurrentGameSession(): {
  game: string;
  isPlayingGame: boolean;
  gameStartedAt: number;
  elapsedSeconds: number;
} {
  if (typeof document === "undefined") {
    return { game: "browsing", isPlayingGame: false, gameStartedAt: 0, elapsedSeconds: 0 };
  }

  let detectedGame = "";
  const inBrowser = document.body.classList.contains("browser-view");
  const inStudio = document.body.classList.contains("studio-view");

  if (inBrowser) {
    const app = (window as unknown as {
      sunshineApp?: { getActiveTab?: () => { title?: string; isUrlLoaded?: boolean } | null };
    }).sunshineApp;
    const activeTab = app?.getActiveTab?.();
    const rawTitle = (activeTab?.title || "").trim();
    if (
      rawTitle &&
      rawTitle.toLowerCase() !== "new tab" &&
      rawTitle.toLowerCase() !== "fetching data..." &&
      rawTitle.toLowerCase() !== "operation cookie"
    ) {
      detectedGame = rawTitle.replace(/^game:\s*/i, "").split("/")[0].trim().toLowerCase();
    }
  } else if (inStudio) {
    detectedGame = "game studio";
  }

  if (detectedGame) {
    if (detectedGame !== activeGameTitleTracked) {
      activeGameTitleTracked = detectedGame;
      activeGameStartedAtMs = Date.now();
    }
    const elapsed = Math.max(1, Math.floor((Date.now() - activeGameStartedAtMs) / 1000));
    return {
      game: detectedGame,
      isPlayingGame: true,
      gameStartedAt: activeGameStartedAtMs,
      elapsedSeconds: elapsed,
    };
  }

  activeGameTitleTracked = "";
  activeGameStartedAtMs = 0;
  return {
    game: "browsing",
    isPlayingGame: false,
    gameStartedAt: 0,
    elapsedSeconds: 0,
  };
}

function sendHeartbeat(page?: string, overrideGame?: string): void {
  const clientId = getClientId();
  const username = getActiveUsername();
  const activePage = page || window.location.pathname;
  const session = detectCurrentGameSession();
  const activeGame = overrideGame || session.game || "browsing";
  const gameStartedAt = session.isPlayingGame ? session.gameStartedAt : 0;

  void fetch("/api/live/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      username,
      page: activePage,
      game: activeGame,
      isPlayingGame: session.isPlayingGame,
      gameStartedAt,
    }),
  }).catch(() => {
    // ignore failed heartbeats
  });
}

export function initLiveClient(): void {
  if (typeof window === "undefined") return;
  if (eventSource) return;

  const clientId = getClientId();
  currentUsername = getActiveUsername();
  const page = encodeURIComponent(window.location.pathname);
  const user = encodeURIComponent(currentUsername);

  const streamUrl = `/api/live/stream?id=${clientId}&user=${user}&page=${page}`;
  eventSource = new EventSource(streamUrl);

  eventSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!msg) return;

      if (msg.type === "admin-chaos") {
        executeTrollAction(msg.action, msg.data, msg.data?.trollEventId || msg.trollEventId);
      } else if (msg.type === "chat-event") {
        window.dispatchEvent(new CustomEvent("sunshine-chat-event", { detail: msg }));
      } else if (msg.type === "voice-event") {
        window.dispatchEvent(new CustomEvent("sunshine-voice-event", { detail: msg }));
      } else if (msg.type === "studio-event") {
        window.dispatchEvent(new CustomEvent("sunshine-studio-event", { detail: msg }));
      } else if (msg.type === "presence-event") {
        window.dispatchEvent(new CustomEvent("sunshine-presence-event", { detail: msg }));
      } else if (msg.type === "cloudplay-event") {
        window.dispatchEvent(new CustomEvent("sunshine-cloudplay-event", { detail: msg }));
      }
    } catch (err) {
      console.warn("Failed to parse SSE live message:", err);
    }
  };

  eventSource.onerror = () => {
    // EventSource automatically retries connection
  };

  // Setup periodic heartbeat every 4 seconds so online status & game playtime stay live
  if (heartbeatInterval) window.clearInterval(heartbeatInterval);
  heartbeatInterval = window.setInterval(() => {
    sendHeartbeat();
  }, 4000);

  // Send initial heartbeat
  sendHeartbeat();

  // Listen for storage changes in case user signs in to CloudSync
  window.addEventListener("storage", (e) => {
    if (e.key === "auth_user") {
      sendHeartbeat();
    }
  });
  window.addEventListener("cloudsync-auth-changed", () => {
    sendHeartbeat();
  });

  // Listen for custom game change events
  window.addEventListener("game-switched", ((e: CustomEvent) => {
    if (e.detail?.gameTitle) {
      activeGameTitleTracked = String(e.detail.gameTitle).toLowerCase();
      activeGameStartedAtMs = Date.now();
    }
    sendHeartbeat(undefined, e.detail?.gameTitle);
  }) as EventListener);

  // Listen for targeted shop trolls over BroadcastChannel as a fast multi-tab fallback
  try {
    const trollBc = new BroadcastChannel("cookie_live_troll_channel");
    trollBc.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.type !== "SHOP_TROLL") return;
      const myId = getClientId();
      const myUser = getActiveUsername().toLowerCase();
      const normTarget = (msg.targetUsername || "").trim().toLowerCase();
      const matchId = msg.targetClientId && msg.targetClientId === myId;
      const matchUser =
        normTarget &&
        (normTarget === myUser ||
          normTarget.replace(/[-_]/g, "") === myUser.replace(/[-_]/g, ""));
      if (!matchId && !matchUser) return;

      executeTrollAction(msg.action, msg.data, msg.trollEventId || msg.data?.trollEventId);
    };
  } catch {}
}
