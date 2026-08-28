/** 설정 — JSON 파일 하나. 손으로도 고칠 수 있어야 하므로 zod 로 검증하고,
 * 틀린 곳을 사람이 읽을 수 있게 말한다.
 *
 * 「안 보낸 것」과 「비운 것」을 구별하지 않아도 되도록 부분 수정 API 를 두지 않는다 —
 * 화면은 항상 전체를 읽고 전체를 쓴다. 설정은 작다. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SourceSchema = z.object({
  /** 서버 `source_key`. 한 번 정하면 바꾸지 않는다 — 원장과 서버가 이 키로 잇는다. */
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, "소문자·숫자·_·- 로 2~40자"),
  name: z.string().min(1).max(100),
  path: z.string().min(1),
  /** 소문자, 점 포함(`.tra`). 비어 있으면 전부. */
  extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/)).default([]),
  recursive: z.boolean().default(false),
  /** 이 시간 동안 mtime·크기가 안 변해야 "쓰기가 끝났다" 로 본다. */
  stableMinutes: z.number().int().min(0).max(1440).default(2),
  /** 파일명 → 힌트. 이름 있는 그룹(`(?<material_code>...)`)만 뜻이 있다. */
  filenameRule: z.string().nullable().default(null),
  /** 소스 기본값 — "이 폴더 파일은 전부 이 재료·로트". 파일명에 없는 힌트를 채운다.
   * 장비는 대개 시편 번호만 적는다. 파일명 규칙이 뽑은 값이 있으면 그쪽이 이긴다. */
  defaults: z
    .object({
      material_code: z.string().nullable().default(null),
      lot: z.string().nullable().default(null),
    })
    .default({}),
  /** 보낸 뒤 원본을 옮길 하위 폴더 이름. null 이면 제자리(기본, 결정 D). */
  moveAfterSendTo: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});
export type Source = z.infer<typeof SourceSchema>;

export const ScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(1).max(1440) }),
  z.object({
    kind: z.literal("daily"),
    /** `HH:MM` 로컬 시각. */
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  server: z.object({
    url: z.string().url().nullable().default(null),
    /** 서버가 준 커넥터 id. PAT 는 여기 두지 않는다 — safeStorage 로 따로. */
    connectorId: z.string().nullable().default(null),
    connectorName: z.string().default(""),
    /** 사내망 HTTPS. 자체 서명 인증서는 Node 가 거부한다 — 둘 중 하나로 푼다. */
    tls: z
      .object({
        /** 인증서 검증을 끈다. 폐쇄망에서 CA 를 못 받을 때. 화면이 경고한다. */
        insecure: z.boolean().default(false),
        /** 사내 CA 인증서(PEM) 경로. 있으면 이것으로 검증한다. */
        caFile: z.string().nullable().default(null),
      })
      .default({}),
  }).default({}),
  /** 끝난 원장 행(보냄·중복·사라짐)을 이 일수 뒤 지운다. 실패는 남긴다. */
  retentionDays: z.number().int().min(7).max(3650).default(90),
  sources: z.array(SourceSchema).default([]),
  schedule: ScheduleSchema.default({ kind: "interval", minutes: 60 }),
  /** 폴더를 훑는 주기. 감시 이벤트는 놓칠 수 있어 스캔이 정본이다. */
  scanMinutes: z.number().int().min(1).max(60).default(5),
});
export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export class ConfigError extends Error {}

export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (result.success) {
    const keys = result.data.sources.map((s) => s.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) throw new ConfigError(`소스 키가 겹칩니다: ${dup}`);
    return result.data;
  }
  const lines = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new ConfigError(`설정이 올바르지 않습니다\n${lines.join("\n")}`);
}

export function configPath(dataDir: string): string {
  return path.join(dataDir, "config.json");
}

export function loadConfig(dataDir: string): Config {
  const file = configPath(dataDir);
  if (!existsSync(file)) return defaultConfig();
  return parseConfig(JSON.parse(readFileSync(file, "utf8")));
}

export function saveConfig(dataDir: string, config: Config): void {
  mkdirSync(dataDir, { recursive: true });
  const validated = parseConfig(config);
  // 쓰다 죽어도 반쪽짜리 설정이 남지 않게 임시 파일에 쓰고 바꿔 넣는다.
  const file = configPath(dataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(validated, null, 2), "utf8");
  renameSync(tmp, file);
}
