// Rasterize the envx vault logo (same geometry as public/icon.svg) to PNGs
// for platforms that do not take SVG manifest icons. No dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x1b, 0x1d, 0x22];
const METAL = [0x4b, 0x4f, 0x59];
const DOOR = [0x26, 0x29, 0x30];
const ACCENT = [0x5c, 0xc8, 0xd7];

function roundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const circle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Round-capped line of width w from (x1, y1) to (x2, y2), like an SVG stroke with linecap="round". */
function capsule(x, y, x1, y1, x2, y2, w) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return circle(x, y, x1 + t * dx, y1 + t * dy, w / 2);
}

// Door geometry, matching public/icon.svg.
const CX = 272;
const CY = 256;
const KNOBS = [
  [272.0, 176.0],
  [348.1, 231.3],
  [319.0, 320.7],
  [225.0, 320.7],
  [195.9, 231.3],
];

/** Color at a point in the 512-unit design space, or null for transparent. */
function sample(x, y, maskable) {
  // Maskable icons need a full-bleed background and art inside the 80% safe zone.
  const k = maskable ? 0.78 : 1;
  const u = 256 + (x - 256) / k;
  const v = 256 + (y - 256) / k;
  const inBg = maskable || roundRect(x, y, 0, 0, 512, 512, 112);
  if (!inBg) return null;
  if (circle(u, v, CX, CY, 10)) return DOOR; // hub center
  if (circle(u, v, CX, CY, 26)) return ACCENT; // hub
  for (const [kx, ky] of KNOBS) {
    if (circle(u, v, kx, ky, 15) || capsule(u, v, CX, CY, kx, ky, 16)) return ACCENT; // handle wheel
  }
  if (circle(u, v, CX, CY, 128)) return DOOR;
  if (circle(u, v, CX, CY, 150)) return ACCENT; // door rim
  if (roundRect(u, v, 84, 176, 52, 44, 12) || roundRect(u, v, 84, 292, 52, 44, 12)) return METAL; // hinges
  for (const [rx, ry] of [[96, 96], [416, 96], [96, 416], [416, 416]]) if (circle(u, v, rx, ry, 10)) return METAL; // rivets
  return BG;
}

function render(size, maskable) {
  const ss = 4; // supersampling for anti-aliasing
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((px + (sx + 0.5) / ss) / size) * 512, ((py + (sy + 0.5) / ss) / size) * 512, maskable);
          if (c) {
            r += c[0]; g += c[1]; b += c[2]; a += 1;
          }
        }
      }
      const o = 1 + px * 4;
      if (a) {
        row[o] = r / a; row[o + 1] = g / a; row[o + 2] = b / a;
      }
      row[o + 3] = (a / (ss * ss)) * 255;
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon-192.png', out), render(192, false));
writeFileSync(new URL('icon-512.png', out), render(512, false));
writeFileSync(new URL('icon-maskable-512.png', out), render(512, true));
writeFileSync(new URL('apple-touch-icon.png', out), render(180, true));
console.log('icons: wrote public/icons/*.png');
