// gta6-meme-x-01: a deterministic GTA 6 meme generator (Node 22, stdlib only).
//
// It draws one 1024x1024 meme PNG from scratch — a Vice City sunset, the
// make.fun ghost holding its magenta star coin, and the caption
// "13 YEARS WAITING FOR GTA 6 / MY AGENT IS ALREADY EARNING ON MAKE.FUN" —
// and copies POST.json (the X post's address) to the output directory.
// No network, no clock, no files outside the repository: two runs write
// the same bytes.
//
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

function rgb(r: number, g: number, b: number): RGB {
  return [r, g, b];
}

// A tiny deterministic PRNG (mulberry32) for window lights etc.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- PNG encoding (pure stdlib) -------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Framebuffer ------------------------------------------------------------

class Canvas {
  pixels: Uint8Array;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = c[0];
    this.pixels[i + 1] = c[1];
    this.pixels[i + 2] = c[2];
    this.pixels[i + 3] = 255;
  }

  // Alpha-blend a color over the pixel (a in 0..1).
  blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = Math.round(this.pixels[i] * (1 - a) + c[0] * a);
    this.pixels[i + 1] = Math.round(this.pixels[i + 1] * (1 - a) + c[1] * a);
    this.pixels[i + 2] = Math.round(this.pixels[i + 2] * (1 - a) + c[2] * a);
    this.pixels[i + 3] = 255;
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const xa = Math.max(0, Math.floor(x0));
    const xb = Math.min(this.width - 1, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0));
    const yb = Math.min(this.height - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) this.set(x, y, c);
    }
  }

  // Vertical gradient between stops: [position 0..1, color].
  vgrad(y0: number, y1: number, stops: Array<[number, RGB]>): void {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.height - 1, Math.ceil(y1)); y++) {
      const t = (y - y0) / (y1 - y0);
      let a = stops[0];
      let b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) {
          a = stops[s];
          b = stops[s + 1];
          break;
        }
      }
      const span = b[0] - a[0] || 1;
      const f = Math.min(1, Math.max(0, (t - a[0]) / span));
      const c: RGB = [
        Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
        Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
        Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
      ];
      for (let x = 0; x < this.width; x++) this.set(x, y, c);
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB): void {
    const rr = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rr) this.set(x, y, c);
      }
    }
  }
}

// ---- Shapes -----------------------------------------------------------------

// Scanline fill of a simple polygon (vertices as [x, y]).
function fillPolygon(cv: Canvas, pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) cv.set(x, y, c);
    }
  }
}

// 5-point star polygon.
function starPoints(cx: number, cy: number, rOut: number, rIn: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
  }
  return pts;
}

// 4-point sparkle (the ghost's eyes): a diamond with pinched sides.
function sparklePoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const p = r * 0.22;
  return [
    [cx, cy - r],
    [cx + p, cy - p],
    [cx + r, cy],
    [cx + p, cy + p],
    [cx, cy + r],
    [cx - p, cy + p],
    [cx - r, cy],
    [cx - p, cy - p],
  ];
}

// A thick curved line drawn as a chain of discs along a quadratic bezier.
function bezierThick(
  cv: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r0: number,
  r1: number,
  c: RGB,
): void {
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
    const y = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
    cv.disc(x, y, r0 + (r1 - r0) * t, c);
  }
}

// The ghost's silhouette test: rounded top, straight sides, wavy hem.
function ghostInside(x: number, y: number, cx: number, topY: number, r: number, hemY: number): boolean {
  const domeCy = topY + r;
  if (y < topY) return false;
  if (y <= domeCy) {
    const dx = x - cx;
    const dy = y - domeCy;
    return dx * dx + dy * dy <= r * r;
  }
  if (y <= hemY) return Math.abs(x - cx) <= r;
  // Hem: three scallop bumps hanging below hemY.
  const bumpR = r / 3;
  for (let k = -1; k <= 1; k++) {
    const bx = cx + k * 2 * bumpR;
    const by = hemY + bumpR * 0.55;
    const dx = x - bx;
    const dy = y - by;
    if (dx * dx + dy * dy <= bumpR * bumpR && y >= hemY) return true;
  }
  return false;
}

function drawGhostShape(
  cv: Canvas,
  cx: number,
  topY: number,
  r: number,
  hemY: number,
  dx: number,
  dy: number,
  c: RGB,
): void {
  const bumpR = r / 3;
  const x0 = Math.floor(cx - r - 4);
  const x1 = Math.ceil(cx + r + 4);
  const y0 = Math.floor(topY - 4);
  const y1 = Math.ceil(hemY + bumpR * 1.6 + 4);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (ghostInside(x - dx, y - dy, cx, topY, r, hemY)) cv.set(x, y, c);
    }
  }
}

// ---- 5x7 bitmap font (only the glyphs the captions use) ---------------------

const FONT: Record<string, string[]> = {
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
  ".": ["     ", "     ", "     ", "     ", "     ", " ##  ", " ##  "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"],
  "3": ["#####", "    #", "    #", " ### ", "    #", "    #", "#####"],
  "6": [" ### ", "#    ", "#    ", "#### ", "#   #", "#   #", " ### "],
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  F: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  G: [" ### ", "#   #", "#    ", "# ###", "#   #", "#   #", " ####"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"],
  K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "## ##", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
};

function drawText(cv: Canvas, line: string, centerX: number, topY: number, scale: number, maxWidth: number): void {
  const s = Math.max(1, Math.min(scale, Math.floor(maxWidth / (line.length * 6))));
  const w = line.length * 6 * s - s;
  let x = Math.round(centerX - w / 2);
  const ink: RGB = rgb(255, 255, 255);
  const outline: RGB = rgb(17, 17, 17);
  const off = Math.max(2, Math.round(s / 3));
  const paint = (dx: number, dy: number, c: RGB) => {
    let cx = x + dx;
    for (const ch of line) {
      const g = FONT[ch] ?? FONT[" "];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (g[row][col] === "#") {
            cv.fillRect(cx + dx + col * s, topY + dy + row * s, cx + dx + (col + 1) * s - 1, topY + dy + (row + 1) * s - 1, c);
          }
        }
      }
      cx += 6 * s;
    }
  };
  for (const [dx, dy] of [[-off, 0], [off, 0], [0, -off], [0, off], [-off, -off], [off, -off], [-off, off], [off, off]] as Array<[number, number]>) {
    paint(dx, dy, outline);
  }
  paint(0, 0, ink);
}

// ---- Scene --------------------------------------------------------------------

const SKY: Array<[number, RGB]> = [
  [0, rgb(27, 11, 59)],
  [0.35, rgb(123, 30, 110)],
  [0.6, rgb(214, 51, 108)],
  [0.8, rgb(255, 126, 61)],
  [1, rgb(255, 196, 107)],
];

function skyColorAt(y: number): RGB {
  const t = y / 700;
  let a = SKY[0];
  let b = SKY[SKY.length - 1];
  for (let s = 0; s < SKY.length - 1; s++) {
    if (t >= SKY[s][0] && t <= SKY[s + 1][0]) {
      a = SKY[s];
      b = SKY[s + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const f = Math.min(1, Math.max(0, (t - a[0]) / span));
  return [
    Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
    Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
    Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
  ];
}

function drawSun(cv: Canvas): void {
  const cx = 255;
  const cy = 520;
  const r = 150;
  cv.disc(cx, cy, r, rgb(255, 158, 61));
  cv.disc(cx, cy, r - 26, rgb(255, 214, 110));
  cv.disc(cx, cy, r - 62, rgb(255, 233, 138));
  // Retro slices: horizontal gaps that widen toward the bottom.
  let y = cy + 8;
  let gap = 5;
  while (y < cy + r) {
    cv.fillRect(cx - r, y, cx + r, y + gap, skyColorAt(y));
    y += gap + 26;
    gap += 4;
  }
}

function drawSkyline(cv: Canvas): void {
  const rnd = mulberry32(20261119);
  const base = 706;
  const col = rgb(21, 8, 41);
  const win = rgb(255, 209, 102);
  let x = 24;
  while (x < 1000) {
    const w = 42 + Math.floor(rnd() * 52);
    const h = 44 + Math.floor(rnd() * 108);
    cv.fillRect(x, base - h, x + w, base, col);
    for (let wy = base - h + 10; wy < base - 12; wy += 16) {
      for (let wx = x + 8; wx < x + w - 8; wx += 14) {
        if (rnd() < 0.32) cv.fillRect(wx, wy, wx + 5, wy + 7, win);
      }
    }
    x += w + 6 + Math.floor(rnd() * 18);
  }
}

function drawOcean(cv: Canvas): void {
  cv.vgrad(700, 1024, [
    [0, rgb(14, 74, 107)],
    [1, rgb(4, 38, 62)],
  ]);
  // Sun reflection: short staggered shimmer dashes under the sun.
  const rnd = mulberry32(77);
  for (let y = 712; y < 1024; y += 14) {
    const spread = 26 + (y - 712) * 0.16;
    const w = spread * (0.55 + rnd() * 0.45);
    const a = 0.34 - ((y - 712) / 312) * 0.2;
    const ccx = 255 + (rnd() - 0.5) * 44;
    for (let yy = y; yy < y + 3 && yy < 1024; yy++) {
      for (let x = Math.floor(ccx - w); x <= Math.ceil(ccx + w); x++) {
        cv.blend(x, yy, rgb(255, 190, 90), Math.max(0.08, a));
      }
    }
  }
}

function drawPalm(cv: Canvas, baseX: number, baseY: number, lean: number, size: number, c: RGB): void {
  const topX = baseX + lean * size;
  const topY = baseY - size;
  bezierThick(cv, baseX, baseY, baseX + lean * size * 0.4, baseY - size * 0.55, topX, topY, 13, 7, c);
  for (let k = 0; k < 6; k++) {
    const ang = (-168 + k * 42) * (Math.PI / 180);
    const len = size * (0.4 + (k % 2) * 0.09);
    const ex = topX + Math.cos(ang) * len;
    const ey = topY + Math.sin(ang) * len * 0.5 + 58;
    bezierThick(cv, topX, topY, topX + Math.cos(ang) * len * 0.55, topY - 26, ex, ey, 8, 2, c);
  }
  cv.disc(topX, topY, 12, c);
}

// ---- The make.fun ghost --------------------------------------------------------

function drawGhost(cv: Canvas): void {
  const cx = 512;
  const topY = 258;
  const r = 148;
  const hemY = 566;
  const black: RGB = rgb(17, 17, 17);
  const white: RGB = rgb(255, 255, 255);
  // Thick black outline: the silhouette stamped around the white one.
  for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-5, -5], [5, -5], [-5, 5], [5, 5]] as Array<[number, number]>) {
    drawGhostShape(cv, cx, topY, r, hemY, dx, dy, black);
  }
  drawGhostShape(cv, cx, topY, r, hemY, 0, 0, white);
  // Sparkle eyes.
  fillPolygon(cv, sparklePoints(cx - 56, 400, 30), black);
  fillPolygon(cv, sparklePoints(cx + 56, 400, 30), black);
  // Little round hand holding the magenta star coin.
  cv.disc(cx + 152, 512, 30, black);
  cv.disc(cx + 152, 512, 23, white);
  cv.disc(cx + 196, 496, 46, black);
  cv.disc(cx + 196, 496, 39, rgb(233, 30, 140));
  fillPolygon(cv, starPoints(cx + 196, 496, 27, 11), white);
}

// ---- Assemble + entrypoint ------------------------------------------------------

function drawMeme(): Buffer {
  const cv = new Canvas(W, H);
  cv.vgrad(0, 700, SKY);
  drawSun(cv);
  drawSkyline(cv);
  drawOcean(cv);
  drawPalm(cv, 84, 730, 0.5, 300, rgb(18, 6, 31));
  drawPalm(cv, 950, 740, -0.45, 270, rgb(18, 6, 31));
  drawGhost(cv);
  drawText(cv, "13 YEARS WAITING", 512, 52, 10, 940);
  drawText(cv, "FOR GTA 6", 512, 146, 10, 940);
  drawText(cv, "MY AGENT IS ALREADY", 512, 792, 9, 940);
  drawText(cv, "EARNING ON MAKE.FUN", 512, 884, 9, 940);
  return encodePng(cv.pixels, W, H);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const botDir = process.env.MAKEFUN_BOT_DIR ?? "/bot";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const postPath = join(botDir, "POST.json");
  let post: unknown;
  try {
    post = JSON.parse(readFileSync(postPath, "utf8"));
  } catch (err) {
    fail(`POST.json could not be read from ${botDir}: ${(err as Error).message}`);
  }
  if (
    typeof post !== "object" ||
    post === null ||
    typeof (post as { url?: unknown }).url !== "string" ||
    (post as { url: string }).url.length === 0
  ) {
    fail("POST.json must be an object with a url string");
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "meme.png"), drawMeme());
  copyFileSync(postPath, join(outDir, "POST.json"));
}

main();
