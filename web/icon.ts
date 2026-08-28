/**
 * Draws the home-screen icon and encodes it as a PNG data URI.
 *
 * iOS ignores an SVG `apple-touch-icon`; without a real PNG, Add to Home
 * Screen falls back to a screenshot of the page. Rather than pull in a
 * rendering library for one 180px tile, this rasterises a thick polyline by
 * distance-to-segment (which gives antialiasing for free) and writes the PNG
 * by hand — the format is three chunks, and node:zlib supplies the only hard
 * part.
 */
import { deflateSync } from 'node:zlib';

const SIZE = 180;
const BG: RGB = [0x0b, 0x0b, 0x0f];
const FG: RGB = [0x00, 0xd2, 0x64];
const STROKE = 13;

type RGB = [number, number, number];
type Point = [number, number];

/** An ascending line with a dot at the peak: the app's own accent on its ground. */
const POLYLINE: Point[] = [
  [28, 126],
  [62, 96],
  [92, 110],
  [124, 62],
  [152, 44],
];
const DOT: Point = [152, 44];
const DOT_R = 10;

/** Shortest distance from p to segment ab. */
function distToSegment(px: number, py: number, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Coverage in [0,1] for a shape whose edge sits at `radius`, over one pixel. */
function coverage(dist: number, radius: number): number {
  return Math.max(0, Math.min(1, radius + 0.5 - dist));
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** Encodes RGB pixel rows as a PNG (colour type 2, 8-bit, no filtering). */
function encodePng(pixels: Buffer, size: number): Buffer {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderIcon(): string {
  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  const half = STROKE / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Sample at pixel centres so the coverage ramp is symmetric.
      const px = x + 0.5;
      const py = y + 0.5;

      let nearest = Infinity;
      for (let i = 0; i < POLYLINE.length - 1; i++) {
        const d = distToSegment(px, py, POLYLINE[i], POLYLINE[i + 1]);
        if (d < nearest) nearest = d;
      }
      const line = coverage(nearest, half);
      const dot = coverage(Math.hypot(px - DOT[0], py - DOT[1]), DOT_R);
      const a = Math.max(line, dot);

      const at = (y * SIZE + x) * 3;
      for (let c = 0; c < 3; c++) {
        pixels[at + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
      }
    }
  }

  return `data:image/png;base64,${encodePng(pixels, SIZE).toString('base64')}`;
}
