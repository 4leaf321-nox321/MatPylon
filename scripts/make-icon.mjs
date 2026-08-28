// 앱 아이콘을 코드로 만든다 — 디자인 자산 없이 설치파일이 기본 Electron 아이콘으로
// 나가지 않게. 파란 둥근 사각형에 위로 가는 화살표(배달·업로드). PNG 인코더도 여기
// 직접 쓴다: 의존성 하나 늘리는 것보다 40줄이 싸다.
//   node scripts/make-icon.mjs  → build/icon.png (256×256). electron-builder 가 ico 로 바꾼다.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const N = 256;
const px = new Uint8Array(N * N * 4);

const inRounded = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), N - 1 - r);
  const cy = Math.min(Math.max(y, r), N - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// 화살표: 몸통(가운데 세로 막대) + 머리(삼각형)
const inArrow = (x, y) => {
  const cxm = N / 2;
  if (y >= 118 && y <= 200 && Math.abs(x - cxm) <= 18) return true; // 몸통
  if (y >= 56 && y < 128) {
    const half = ((y - 56) / 72) * 62; // 위로 갈수록 좁아진다
    return Math.abs(x - cxm) <= half;
  }
  return false;
};

for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    if (!inRounded(x, y, 52)) continue; // 투명
    const arrow = inArrow(x, y);
    px[i] = arrow ? 255 : 30;
    px[i + 1] = arrow ? 255 : 120;
    px[i + 2] = arrow ? 255 : 200;
    px[i + 3] = 255;
  }

// --- PNG ---
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0; // filter none
  Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync("build", { recursive: true });
writeFileSync("build/icon.png", png);
console.log("build/icon.png", png.length, "bytes");
