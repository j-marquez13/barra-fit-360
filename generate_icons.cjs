// Genera los íconos PNG de Barra Fit 360 (PWA) sin dependencias externas.
// Uso: node generate_icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- Utilidades PNG (sin librerías) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA (compression, filter e interlace quedan en 0)

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Diseño del ícono ----------
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const lerp = (a, b, t) => a + (b - a) * t;

const CYAN = [0, 242, 254];
const GREEN = [0, 230, 118];
const BG_TOP = [15, 23, 42];
const BG_BOTTOM = [7, 11, 21];

// Fuente bitmap 5x7 solo para "360"
const GLYPHS = {
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110']
};

function drawText(rgba, size, text) {
  const gw = 5, gh = 7, spacing = 1;
  const totalW = text.length * gw + (text.length - 1) * spacing;
  const scale = Math.floor((size * 0.6) / totalW);
  if (scale < 1) return; // en íconos muy pequeños el texto no se ve; se deja solo el fondo
  const w = totalW * scale;
  const h = gh * scale;
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);

  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPHS[text[i]];
    const gx0 = i * (gw + spacing) * scale;
    for (let row = 0; row < gh; row++) {
      const t = row / (gh - 1);
      const cr = lerp(CYAN[0], GREEN[0], t);
      const cg = lerp(CYAN[1], GREEN[1], t);
      const cb = lerp(CYAN[2], GREEN[2], t);
      for (let col = 0; col < gw; col++) {
        if (glyph[row][col] === '1') {
          const px0 = ox + gx0 + col * scale;
          const py0 = oy + row * scale;
          for (let dy = 0; dy < scale; dy++) {
            const y = py0 + dy;
            for (let dx = 0; dx < scale; dx++) {
              const x = px0 + dx;
              if (x < 0 || y < 0 || x >= size || y >= size) continue;
              const idx = (y * size + x) * 4;
              rgba[idx] = clamp(cr);
              rgba[idx + 1] = clamp(cg);
              rgba[idx + 2] = clamp(cb);
              rgba[idx + 3] = 255;
            }
          }
        }
      }
    }
  }
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const glow = size * 0.62;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = y / (size - 1);
      let r = lerp(BG_TOP[0], BG_BOTTOM[0], t);
      let g = lerp(BG_TOP[1], BG_BOTTOM[1], t);
      let b = lerp(BG_TOP[2], BG_BOTTOM[2], t);

      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / glow;
      if (d < 1) {
        const k = Math.pow(1 - d, 2) * 0.45;
        r = lerp(r, CYAN[0], k);
        g = lerp(g, CYAN[1], k);
        b = lerp(b, CYAN[2], k);
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = clamp(r);
      rgba[idx + 1] = clamp(g);
      rgba[idx + 2] = clamp(b);
      rgba[idx + 3] = 255;
    }
  }

  if (size >= 64) drawText(rgba, size, '360');
  return rgba;
}

const sizes = [512, 192, 180, 32, 16];
for (const size of sizes) {
  const png = encodePNG(size, size, makeIcon(size));
  const name = `icon-${size}.png`;
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`✅ Generado public/icons/${name} (${size}x${size}, ${png.length} bytes)`);
}
console.log('Listo. Íconos PWA generados.');
