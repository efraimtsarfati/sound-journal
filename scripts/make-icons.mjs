// Generates the PWA icons (public/icon-192.png, icon-512.png, apple-touch-icon.png) with no dependencies.
// Dark square, white ring and dot. Run: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let c,
    crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / size;
      // Maskable-safe: all artwork inside the central 60%.
      const on = d < 0.07 || (d > 0.17 && d < 0.22);
      const v = on ? 255 : 23;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = v;
      raw[o + 1] = v;
      raw[o + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/icon-192.png", png(192));
writeFileSync("public/icon-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));
