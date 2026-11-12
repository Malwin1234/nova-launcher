// Erzeugt build/icon.png (512x512) ohne zusätzliche Abhängigkeiten.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 512;
const raw = Buffer.alloc((S * 4 + 1) * S);
const mix = (a, b, t) => Math.round(a + (b - a) * t);

for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < S; x++) {
    const i = row + 1 + x * 4;
    // abgerundetes Quadrat
    const r = 110;
    const dx = Math.max(r - x, x - (S - 1 - r), 0);
    const dy = Math.max(r - y, y - (S - 1 - r), 0);
    const inside = dx * dx + dy * dy <= r * r;
    if (!inside) continue;
    const t = (x + y) / (2 * S);
    let c = [mix(0x7c, 0x36, t), mix(0x5c, 0xd6, t), mix(0xff, 0xa3, t)];
    // "N" aus Blöcken
    const gx = Math.floor((x - 136) / 48);
    const gy = Math.floor((y - 136) / 48);
    if (gx >= 0 && gx < 5 && gy >= 0 && gy < 5 && x >= 136 && y >= 136) {
      if (gx === 0 || gx === 4 || gx === gy) c = [255, 255, 255];
    }
    raw[i] = c[0];
    raw[i + 1] = c[1];
    raw[i + 2] = c[2];
    raw[i + 3] = 255;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Icon geschrieben:', out);
