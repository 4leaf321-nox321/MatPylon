/** 화면 테스트용 가짜 `window.matpylon`.
 *
 * 화면은 IPC 너머를 모른다 — 그 경계를 그대로 흉내 내면 Electron 없이 화면만 시험할 수 있다.
 * 계약(`MatPylonApi`)을 타입으로 받으므로, IPC 에 새 함수가 생기면 여기가 먼저 빨개진다. */
import { vi } from "vitest";
import { defaultConfig, type Config } from "@engine/config";
import type { EngineStatus, MatPylonApi } from "@shared/ipc";

export const baseStatus: EngineStatus = {
  appVersion: "0.0.0-test",
  running: true,
  serverConfigured: true,
  nextRunAt: "2026-08-29T10:00:00.000Z",
  lastError: null,
  counts: { seen: 0, ready: 0, sent: 0, failed: 0 },
  stabilizingUntil: null,
};

export function installApi(
  overrides: Partial<MatPylonApi> = {},
  opts: { status?: Partial<EngineStatus>; config?: Config } = {},
): MatPylonApi {
  const status: EngineStatus = { ...baseStatus, ...opts.status };
  const config = opts.config ?? defaultConfig();
  const api: MatPylonApi = {
    getStatus: vi.fn(async () => status),
    onStatus: vi.fn(() => () => {}),
    sendNow: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    getConfig: vi.fn(async () => config),
    setConfig: vi.fn(async () => {}),
    hasToken: vi.fn(async () => false),
    setToken: vi.fn(async () => {}),
    testConnection: vi.fn(async () => ({ ok: true, user: "시험 사용자" })),
    registerConnector: vi.fn(async () => ({ id: "connector-1" })),
    listWorkspaces: vi.fn(async () => []),
    resolveHints: vi.fn(async () => null),
    getAutoRegister: vi.fn(async () => null),
    setAutoRegister: vi.fn(async () => false),
    reference: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    requeue: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    listFilenames: vi.fn(async () => []),
    logTail: vi.fn(async () => ""),
    openLogFolder: vi.fn(async () => {}),
    openDataFolder: vi.fn(async () => {}),
    exportConfig: vi.fn(async () => false),
    importConfig: vi.fn(async () => false),
    paths: vi.fn(async () => ({ dataDir: "", configFile: "", logFile: "" })),
    getAutoLaunch: vi.fn(async () => false),
    setAutoLaunch: vi.fn(async () => {}),
    ...overrides,
  };
  window.matpylon = api;
  return api;
}
