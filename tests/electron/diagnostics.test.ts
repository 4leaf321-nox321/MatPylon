/** 진단 묶음 — **폐쇄망에서 들고 나오는 유일한 증거다.**
 *
 * 열리지 않거나(깨진 zip), 정작 필요한 것이 안 들었거나, 토큰이 들어 있으면 곤란하다.
 * zip 은 의존성 없이 직접 쓰므로 규격도 여기서 지킨다. */
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { defaultConfig, SourceSchema, type Config } from "@engine/config";
import type { EngineStatus, LedgerRow } from "@shared/ipc";
import { diagnosticsEntries, diagnosticsFilename, diagnosticsZip, type DiagnosticsInput } from "../../electron/diagnostics";
import { zip } from "../../electron/zip";

const NOW = new Date("2026-09-21T14:30:00+09:00");

/** zip 을 되읽는 최소 파서 — 우리가 쓴 것을 우리가 읽을 수 있는지가 첫 관문이다. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  // EOCD 를 뒤에서 찾는다(주석 없음 — 마지막 22바이트)
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // 중앙 디렉터리 시작
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    // 로컬 헤더에서 본문 위치를 다시 잰다
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const lName = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    const body = buf.subarray(start, start + compressed);
    out.set(name, (method === 8 ? inflateRawSync(body) : body).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("zip 쓰기", () => {
  it("쓴 것을 되읽으면 그대로다 — 한글 이름·빈 파일·큰 파일", () => {
    const big = "가나다라".repeat(5000);
    const back = unzip(zip([
      { name: "요약.txt", data: "한 줄\r\n두 줄" },
      { name: "로그/main.log", data: big },
      { name: "빈.txt", data: "" },
    ], NOW));
    expect([...back.keys()]).toEqual(["요약.txt", "로그/main.log", "빈.txt"]);
    expect(back.get("요약.txt")).toBe("한 줄\r\n두 줄");
    expect(back.get("로그/main.log")).toBe(big);
    expect(back.get("빈.txt")).toBe("");
  });

  it("이름은 UTF-8 플래그를 세운다 — 탐색기가 한글을 안 깨뜨리게", () => {
    const buf = zip([{ name: "요약.txt", data: "x" }], NOW);
    expect(buf.readUInt16LE(6) & 0x0800).toBe(0x0800); // 로컬 헤더 플래그
  });

  it("압축이 되레 커지면 그냥 담는다", () => {
    // 임의 바이트는 deflate 가 못 줄인다 → 방식 0
    const random = randomBytes(2048);
    const buf = zip([{ name: "r.bin", data: random }], NOW);
    expect(buf.readUInt16LE(8)).toBe(0); // 압축 방식 0 = stored
    expect(unzip(buf).get("r.bin")).toBe(random.toString("utf8"));
    expect(buf.readUInt32LE(18)).toBe(2048); // 담은 크기 = 원래 크기
  });
});

function input(over: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  const config: Config = defaultConfig();
  config.server.url = "https://matnexus.local:8443";
  config.server.connectorId = "c-1";
  config.server.connectorName = "인장기-1";
  config.sources.push(
    SourceSchema.parse({
      key: "zwick",
      name: "Zwick 인장기",
      path: "D:\\data\\zwick",
      extensions: [".tra"],
      recursive: true,
      pathRule: "{material_code}/{lot}/*_{specimen}.tra",
      defaults: { temperature: "80C" },
    }),
  );
  const status: EngineStatus = {
    appVersion: "0.1.13",
    running: true,
    serverConfigured: true,
    nextRunAt: "2026-09-21T06:00:00.000Z",
    lastError: "[Zwick 인장기] 폴더를 읽지 못했습니다 — D:\\data\\zwick",
    counts: { seen: 1, ready: 2, sent: 30, failed: 1 },
    stabilizingUntil: null,
  };
  const rows: LedgerRow[] = [
    {
      id: 1, source_key: "zwick", path: "D:\\data\\zwick\\SUS304\\LotA\\t_01.tra", size: 1234,
      status: "failed", attempts: 3, last_error: "MNX-PIPE-0002: 형식을 알 수 없습니다",
      server_id: null, first_seen_at: NOW.getTime(), sent_at: null,
    },
    {
      id: 2, source_key: "zwick", path: "D:\\data\\zwick\\SUS304\\LotA\\t_02.tra", size: 99,
      status: "dismissed", attempts: 1, last_error: "너무 큽니다",
      server_id: null, first_seen_at: NOW.getTime(), sent_at: null,
    },
  ];
  return {
    status, config, rows, hasToken: true,
    dataDir: "C:\\Users\\lab\\AppData\\Roaming\\MatPylon",
    hostname: "ZWICK-PC", platform: "Windows_NT 10.0.26200",
    versions: { electron: "33.0.0", node: "20.18.0" },
    logs: [{ name: "main.log", text: "12:00 보냄: a.tra\r\n12:01 실패: b.tra" }],
    now: NOW,
    ...over,
  };
}

describe("진단 묶음", () => {
  it("요약·설정·이력·로그가 들어간다", () => {
    const back = unzip(diagnosticsZip(input()));
    expect([...back.keys()]).toEqual(["요약.txt", "config.json", "이력.csv", "로그/main.log"]);
    expect(back.get("로그/main.log")).toContain("실패: b.tra");
    expect(JSON.parse(back.get("config.json")!).sources[0].key).toBe("zwick");
  });

  it("요약이 사람이 먼저 볼 것을 담는다 — 버전·오류·소스·실패 사유", () => {
    const s = unzip(diagnosticsZip(input())).get("요약.txt")!;
    expect(s).toContain("0.1.13");
    expect(s).toContain("ZWICK-PC");
    expect(s).toContain("폴더를 읽지 못했습니다");
    expect(s).toContain("{material_code}/{lot}/*_{specimen}.tra");
    expect(s).toContain("temperature=80C");
    expect(s).toContain("MNX-PIPE-0002: 형식을 알 수 없습니다"); // 실패 사유가 그대로
    expect(s).toContain("무시함 1"); // 무시한 것은 실패와 따로 센다
  });

  it("**토큰은 어디에도 없다** — 저장됐다는 사실만", () => {
    const back = unzip(diagnosticsZip(input({ hasToken: true })));
    for (const [, text] of back) expect(text).not.toMatch(/mnx_pat/i);
    expect(back.get("요약.txt")).toContain("저장됨(값은 이 묶음에 없습니다)");
    expect(unzip(diagnosticsZip(input({ hasToken: false }))).get("요약.txt")).toContain("PAT           없음");
  });

  it("이력 CSV 는 엑셀이 한글 경로를 읽게 BOM 을 붙인다", () => {
    const csv = unzip(diagnosticsZip(input())).get("이력.csv")!;
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"D:\\data\\zwick\\SUS304\\LotA\\t_01.tra"');
    expect(csv).toContain('"MNX-PIPE-0002: 형식을 알 수 없습니다"');
  });

  it("로그가 없어도(첫 실행) 묶음은 만들어진다", () => {
    const entries = diagnosticsEntries(input({ logs: [] }));
    expect(entries.map((e) => e.name)).toEqual(["요약.txt", "config.json", "이력.csv"]);
  });

  it("파일 이름에 호스트와 날짜가 들어간다", () => {
    expect(diagnosticsFilename("ZWICK-PC", NOW)).toBe("matpylon-진단-ZWICK-PC-2026-09-21.zip");
  });
});
