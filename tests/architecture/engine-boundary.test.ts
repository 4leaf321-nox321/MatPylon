/** 엔진은 Electron 을 모른다.
 *
 * 사람이 지키는 규약은 반드시 뚫린다. `src/engine` 이 `electron` 이나 렌더러를
 * import 하는 순간 서비스 모드로 떼어 낼 수 없게 되는데, 그것은 나중에야 드러난다. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ENGINE = path.resolve(__dirname, "../../src/engine");
const FORBIDDEN = [/from\s+["']electron/, /require\(["']electron/, /["']@\/|["']\.\.\/renderer/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("engine boundary", () => {
  it("src/engine 은 electron·renderer 를 import 하지 않는다", () => {
    const offenders = walk(ENGINE).filter((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.some((re) => re.test(text));
    });
    expect(offenders).toEqual([]);
  });
});
