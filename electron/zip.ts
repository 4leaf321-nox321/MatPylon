/** 작은 ZIP 쓰기 — 진단 묶음 하나를 만들려고 의존성을 늘리지 않는다.
 *
 * `archiver` 는 electron-builder 의 전이 의존성일 뿐이라 런타임에 기대면 안 되고,
 * Windows 의 `Compress-Archive`·`tar.exe` 를 부르면 프로세스 실행과 사내 정책에 기댄다.
 * ZIP 컨테이너는 규격이 작다 — deflate 는 `node:zlib` 가 해 준다.
 *
 * 쓰는 범위: 파일 여러 개, deflate(방식 8), ZIP64 아님(진단 묶음은 수 MB 다),
 * UTF-8 이름(플래그 비트 11). 폴더 엔트리는 안 만든다 — 이름에 `/` 를 넣으면 탐색기가
 * 알아서 계층으로 보여 준다. */

import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS 시각(FAT). 초는 2초 단위라 홀수는 내려간다 — 진단 묶음엔 충분하다. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  /** 묶음 안의 경로. `/` 로 계층을 만든다. */
  name: string;
  data: Buffer | string;
}

export function zip(entries: ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(raw);
    // 압축이 되레 커지는 작은 파일이 있다 — 그러면 그냥 담는다(방식 0).
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // 로컬 헤더 서명
    local.writeUInt16LE(20, 4); // 필요한 버전 2.0
    local.writeUInt16LE(0x0800, 6); // 플래그: 이름이 UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8); // 압축 방식
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra 없음
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // 중앙 디렉터리 서명
    central.writeUInt16LE(20, 4); // 만든 버전
    central.writeUInt16LE(20, 6); // 필요한 버전
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // 주석
    central.writeUInt16LE(0, 34); // 디스크 번호
    central.writeUInt16LE(0, 36); // 내부 속성
    central.writeUInt32LE(0, 38); // 외부 속성
    central.writeUInt32LE(offset, 42); // 로컬 헤더 위치
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // EOCD 서명
  end.writeUInt16LE(0, 4); // 이 디스크
  end.writeUInt16LE(0, 6); // 중앙 디렉터리가 시작하는 디스크
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // 주석 없음

  return Buffer.concat([...locals, centralDir, end]);
}
