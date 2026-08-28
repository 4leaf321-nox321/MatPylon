import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceSchema } from "@engine/config";
import { Ledger } from "@engine/ledger";
import { scanSource } from "@engine/scanner";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "matpylon-scan-"));
  dirs.push(dir);
  const source = SourceSchema.parse({ key: "src", name: "src", path: dir, extensions: [".tra"] });
  return { dir, source, ledger: new Ledger(":memory:") };
}

/** 파일을 "t 시각에 쓴 것" 으로 만든다. */
function write(file: string, content: string, mtime: number) {
  writeFileSync(file, content);
  utimesSync(file, mtime / 1000, mtime / 1000);
}

const T0 = 1_700_000_000_000;
const MIN = 60_000;

describe("scanner", () => {
  it("방금 쓴 파일은 잡지 않고, 2분 지나면 해시를 붙여 ready", async () => {
    const { dir, source, ledger } = setup();
    write(path.join(dir, "a.tra"), "hello", T0);
    write(path.join(dir, "note.txt"), "x", T0);

    let r = await scanSource(source, ledger, T0);
    expect(r).toMatchObject({ observed: 1, ready: 0 });
    expect(ledger.list()[0]?.status).toBe("seen");

    r = await scanSource(source, ledger, T0 + 2 * MIN);
    expect(r.ready).toBe(1);
    const row = ledger.list()[0]!;
    expect(row.status).toBe("ready");
    expect(row.sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("쓰는 동안 크기가 바뀌면 안정화를 다시 센다", async () => {
    const { dir, source, ledger } = setup();
    const f = path.join(dir, "a.tra");
    write(f, "1", T0);
    await scanSource(source, ledger, T0);
    write(f, "12", T0 + MIN); // 1분 뒤 장비가 더 썼다
    await scanSource(source, ledger, T0 + MIN);
    // 처음 본 시각 기준 2분이 지났지만, 마지막 변경 기준으로는 1분뿐
    let r = await scanSource(source, ledger, T0 + 2 * MIN);
    expect(r.ready).toBe(0);
    r = await scanSource(source, ledger, T0 + 3 * MIN);
    expect(r.ready).toBe(1);
  });

  it("같은 내용의 사본은 duplicate", async () => {
    const { dir, source, ledger } = setup();
    write(path.join(dir, "a.tra"), "same", T0);
    await scanSource(source, ledger, T0);
    await scanSource(source, ledger, T0 + 2 * MIN);
    const a = ledger.list()[0]!;
    ledger.markSent(a.id, null, T0);
    write(path.join(dir, "b.tra"), "same", T0);
    await scanSource(source, ledger, T0 + 2 * MIN); // 처음 봄
    const r = await scanSource(source, ledger, T0 + 4 * MIN);
    expect(r.duplicate).toBe(1);
  });

  it("사라진 파일은 gone, 하위 폴더는 recursive 일 때만, sent 폴더는 건너뜀", async () => {
    const { dir, source, ledger } = setup();
    const f = path.join(dir, "a.tra");
    write(f, "x", T0);
    mkdirSync(path.join(dir, "sub"));
    mkdirSync(path.join(dir, "sent"));
    write(path.join(dir, "sub", "b.tra"), "y", T0);
    write(path.join(dir, "sent", "c.tra"), "z", T0);

    expect((await scanSource(source, ledger, T0)).observed).toBe(1);
    const rec = { ...source, recursive: true, moveAfterSendTo: "sent" };
    expect((await scanSource(rec, ledger, T0 + 2 * MIN)).observed).toBe(2);

    unlinkSync(f);
    const r = await scanSource(rec, ledger, T0 + 3 * MIN);
    expect(r.gone).toBe(1);
    expect(ledger.get("src", f)?.status).toBe("gone");
  });
});
