// Pure TypeScript RGBA PNG encoder + PBR Albedo & Normal Map generator
// Zero external dependencies; optional zlib compressor hook for server-side 512px-2048px textures.

import { QualityConfig, TextureResolution } from './types';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

function deflateStored(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const numBlocks = Math.max(1, Math.ceil(raw.length / maxBlock));
  const out = new Uint8Array(2 + raw.length + numBlocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let offset = 2;
  let pos = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = Math.min(maxBlock, raw.length - pos);
    const isFinal = b === numBlocks - 1 ? 1 : 0;
    out[offset++] = isFinal;
    out[offset++] = len & 0xff;
    out[offset++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    out[offset++] = nlen & 0xff;
    out[offset++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(pos, pos + len), offset);
    offset += len;
    pos += len;
  }
  const adler = adler32(raw);
  out[offset++] = (adler >>> 24) & 0xff;
  out[offset++] = (adler >>> 16) & 0xff;
  out[offset++] = (adler >>> 8) & 0xff;
  out[offset++] = adler & 0xff;
  return out.subarray(0, offset);
}

export type DeflateCompressor = (raw: Uint8Array) => Uint8Array;
let registeredCompressor: DeflateCompressor | null = null;

export function registerPngCompressor(fn: DeflateCompressor) {
  registeredCompressor = fn;
}

export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // None filter
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const idatData = registeredCompressor ? registeredCompressor(raw) : deflateStored(raw);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let ptr = 0;
  png.set(signature, ptr); ptr += signature.length;
  png.set(ihdrChunk, ptr); ptr += ihdrChunk.length;
  png.set(idatChunk, ptr); ptr += idatChunk.length;
  png.set(iendChunk, ptr);
  return png;
}

export function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 6 ? clean : '888888', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function textureResolutionToTargetPx(res: TextureResolution): number {
  switch (res) {
    case '1k': return 1024;
    case '2k': return 2048;
    case '4k': return 4096;
    case '8k': return 8192;
  }
}

/**
 * Resolves the embedded PNG pixel size packed into the VRM/GLB binary container,
 * balancing user TextureResolution against VrmOptimizationMode while keeping
 * generation snappy and full 1K-8K targets stored for Blender bake pipelines.
 */
export function resolvePackedTextureSize(config: QualityConfig): number {
  const hasCompressor = Boolean(registeredCompressor);
  const target = textureResolutionToTargetPx(config.textureResolution);

  if (config.vrmOptimization === 'optimized') {
    return hasCompressor ? Math.min(256, target) : 128;
  }
  if (config.vrmOptimization === 'balanced') {
    if (!hasCompressor) return 128;
    return target >= 4096 ? 512 : 256;
  }
  if (config.vrmOptimization === 'custom') {
    const cap = config.customOptimization.maxVrmTexturePx;
    return hasCompressor ? Math.min(cap, 1024) : Math.min(cap, 256);
  }
  // 'unoptimized' (Max Detail)
  return hasCompressor ? Math.min(1024, target) : 256;
}

export type ProceduralTextureKind =
  | 'skin'
  | 'iris'
  | 'iris_emissive'
  | 'armor'
  | 'hair'
  | 'cloak'
  | 'skin_normal'
  | 'hair_normal'
  | 'armor_normal'
  | 'cloak_normal';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function heightAt(kind: ProceduralTextureKind, u: number, v: number): number {
  if (kind === 'skin_normal') {
    const poreA = Math.sin(u * 150) * Math.cos(v * 150) * 0.08;
    const poreB = Math.sin(u * 80 + 1.2) * Math.sin(v * 90 + 0.7) * 0.06;
    return poreA + poreB;
  }
  if (kind === 'hair_normal') {
    const primaryStrands = Math.sin(u * Math.PI * 44 + Math.sin(v * 6) * 0.9) * 0.42;
    const fineStrands = Math.sin(u * Math.PI * 108) * 0.14;
    return primaryStrands + fineStrands;
  }
  if (kind === 'armor_normal') {
    const edgeGroove =
      Math.exp(-Math.pow((v - 0.12) * 26, 2)) * -0.55 +
      Math.exp(-Math.pow((v - 0.88) * 26, 2)) * -0.55 +
      Math.exp(-Math.pow((u - 0.5) * 22, 2)) * 0.32;
    const brushed = Math.sin(u * 64 + v * 6) * 0.07;
    return edgeGroove + brushed;
  }
  // cloak_normal
  const weaveU = Math.sin(u * Math.PI * 84);
  const weaveV = Math.sin(v * Math.PI * 84);
  const drapeFold = Math.sin(u * Math.PI * 8) * 0.34 * (0.3 + v * 0.7);
  const trimRidge = Math.exp(-Math.pow((v - 0.91) * 34, 2)) * 0.45;
  return weaveU * weaveV * 0.14 + drapeFold + trimRidge;
}

export function generateProceduralTexturePng(
  kind: ProceduralTextureKind,
  primaryHex: string,
  secondaryHex: string,
  size = 256
): Uint8Array {
  const [r1, g1, b1] = parseHexRgb(primaryHex);
  const [r2, g2, b2] = parseHexRgb(secondaryHex);
  const rgba = new Uint8Array(size * size * 4);
  const isNormal = kind.endsWith('_normal');
  const invSize = 1 / Math.max(1, size - 1);
  const du = invSize;

  for (let y = 0; y < size; y++) {
    const v = y * invSize;
    for (let x = 0; x < size; x++) {
      const u = x * invSize;
      const idx = (y * size + x) * 4;

      if (isNormal) {
        const hL = heightAt(kind, u - du, v);
        const hR = heightAt(kind, u + du, v);
        const hD = heightAt(kind, u, v - du);
        const hU = heightAt(kind, u, v + du);
        const strength = kind === 'hair_normal' ? 1.15 : kind === 'armor_normal' ? 1.3 : kind === 'cloak_normal' ? 1.15 : 0.45;
        const dHdu = (hR - hL) * strength;
        const dHdv = (hU - hD) * strength;
        let nx = -dHdu;
        let ny = -dHdv;
        let nz = 1.0;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        rgba[idx] = Math.round((nx * 0.5 + 0.5) * 255);
        rgba[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        rgba[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        rgba[idx + 3] = 255;
        continue;
      }

      let r = r1;
      let g = g1;
      let b = b1;

      if (kind === 'skin') {
        const sssWarm = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
        const micro = Math.sin(u * 90 + v * 70) * 1.8;
        const tone = 0.92 + 0.05 * sssWarm;
        r = Math.min(255, Math.max(0, r1 * tone + 4 * sssWarm + micro));
        g = Math.min(255, Math.max(0, g1 * (0.9 + 0.05 * sssWarm) + micro * 0.7));
        b = Math.min(255, Math.max(0, b1 * (0.9 + 0.05 * sssWarm) + micro * 0.7));
      } else if (kind === 'iris' || kind === 'iris_emissive') {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy) * 2.0;
        const isEmissive = kind === 'iris_emissive';
        const pupilEdge = smoothstep(0.18, 0.23, dist);
        const irisOuter = 1 - smoothstep(0.51, 0.57, dist);
        const irisMask = pupilEdge * irisOuter;

        const angle = Math.atan2(dy, dx);
        const fiberA = 0.78 + 0.24 * Math.sin(angle * 36 + dist * 8);
        const fiberB = 0.92 + 0.1 * Math.cos(angle * 80);
        const limbalDark = 1.0 - smoothstep(0.42, 0.55, dist) * 0.62;
        const innerGlow = 1.0 + (1 - smoothstep(0.22, 0.34, dist)) * 0.24;
        const mult = fiberA * fiberB * limbalDark * innerGlow;

        const irisR = Math.min(255, r1 * mult);
        const irisG = Math.min(255, g1 * mult);
        const irisB = Math.min(255, b1 * mult);

        if (isEmissive) {
          r = irisR * irisMask * 0.85;
          g = irisG * irisMask * 0.85;
          b = irisB * irisMask * 0.85;
        } else {
          // Sclera with subtle upper eyelid shadow
          const upperLidShadow = 0.72 + 0.28 * smoothstep(0.22, 0.52, v);
          const scleraR = 242 * upperLidShadow;
          const scleraG = 243 * upperLidShadow;
          const scleraB = 248 * upperLidShadow;

          const baseMask = smoothstep(0.51, 0.57, dist);
          // Blend pupil (10,10,16) -> iris -> sclera
          const insideEyeR = 10 * (1 - pupilEdge) + irisR * pupilEdge;
          const insideEyeG = 10 * (1 - pupilEdge) + irisG * pupilEdge;
          const insideEyeB = 16 * (1 - pupilEdge) + irisB * pupilEdge;

          r = insideEyeR * (1 - baseMask) + scleraR * baseMask;
          g = insideEyeG * (1 - baseMask) + scleraG * baseMask;
          b = insideEyeB * (1 - baseMask) + scleraB * baseMask;

          // Dual crisp corneal catchlights
          const specA = Math.max(0, 1 - Math.hypot(dx - 0.065, dy + 0.065) / 0.042);
          const specB = Math.max(0, 1 - Math.hypot(dx + 0.055, dy - 0.055) / 0.022) * 0.65;
          const spec = Math.min(1, specA + specB);
          if (spec > 0) {
            r = r + (255 - r) * spec * 0.92;
            g = g + (255 - g) * spec * 0.92;
            b = b + (255 - b) * spec * 0.92;
          }
        }
      } else if (kind === 'armor') {
        const seamAmt =
          Math.exp(-Math.pow((v - 0.12) * 38, 2)) +
          Math.exp(-Math.pow((v - 0.88) * 38, 2));
        const brushed = 0.95 + 0.06 * Math.sin(u * 48 + v * 6);
        const microWear = 0.98 + 0.03 * Math.cos(u * 26 - v * 38);
        const shade = brushed * microWear * (1 - Math.min(0.42, seamAmt * 0.3));
        r = Math.min(255, r1 * shade);
        g = Math.min(255, g1 * shade);
        b = Math.min(255, b1 * shade);
      } else if (kind === 'hair') {
        const strandPrimary = 0.91 + 0.09 * Math.sin(u * Math.PI * 36 + Math.sin(v * 5) * 0.7);
        const strandFine = 0.96 + 0.04 * Math.cos(u * Math.PI * 84);
        const sheen = Math.exp(-Math.pow((v - 0.42) * 2.2, 2)) * 5 * (0.7 + 0.3 * Math.sin(u * Math.PI * 18));
        const rootShadow = 0.82 + 0.18 * Math.min(1, v * 2.4);
        r = Math.min(255, r1 * strandPrimary * strandFine * rootShadow + sheen);
        g = Math.min(255, g1 * strandPrimary * strandFine * rootShadow + sheen);
        b = Math.min(255, b1 * strandPrimary * strandFine * rootShadow + sheen);
      } else {
        // Woven fabric / cloak with smooth anti-aliased hem trim & brocade motif
        const weave = 0.97 + 0.03 * Math.sin(u * 64) * Math.sin(v * 64);
        const foldAo = 0.91 + 0.09 * Math.sin(u * Math.PI * 8);
        const hemBorder = smoothstep(0.91, 0.935, v) + (1 - smoothstep(0.025, 0.05, v));
        const scrollWave = Math.pow(0.5 + 0.5 * Math.sin(u * Math.PI * 24), 4);
        const filigreeBand =
          smoothstep(0.84, 0.86, v) * (1 - smoothstep(0.895, 0.91, v)) * scrollWave;
        const trimAmt = Math.min(1, hemBorder * 0.9 + filigreeBand * 0.75);
        const baseR = r1 * weave * foldAo;
        const baseG = g1 * weave * foldAo;
        const baseB = b1 * weave * foldAo;
        r = Math.min(255, baseR * (1 - trimAmt) + r2 * weave * trimAmt);
        g = Math.min(255, baseG * (1 - trimAmt) + g2 * weave * trimAmt);
        b = Math.min(255, baseB * (1 - trimAmt) + b2 * weave * trimAmt);
      }

      rgba[idx] = Math.round(Math.max(0, Math.min(255, r)));
      rgba[idx + 1] = Math.round(Math.max(0, Math.min(255, g)));
      rgba[idx + 2] = Math.round(Math.max(0, Math.min(255, b)));
      rgba[idx + 3] = 255;
    }
  }

  return encodeRgbaPng(size, size, rgba);
}
