/** 렌더러 ↔ 메인 IPC 계약. 양쪽이 이 파일 하나를 본다 — 채널 이름을 문자열로
 * 흩어 두면 한쪽만 고쳐진다. */

export interface EngineStatus {
  appVersion: string;
  /** 엔진이 돌고 있는가(일시 정지 아님). */
  running: boolean;
  serverConfigured: boolean;
  nextRunAt: string | null;
  lastError: string | null;
  counts: { ready: number; sent: number; failed: number };
}

/** 원장 한 줄 — 이력 화면. 엔진의 FileRow 와 같은 모양이지만 여기서 다시 적는다:
 * 렌더러가 엔진 타입을 import 하면 경계가 흐려진다. */
export interface LedgerRow {
  id: number;
  source_key: string;
  path: string;
  size: number;
  status: string;
  attempts: number;
  last_error: string | null;
  server_id: string | null;
  first_seen_at: number;
  sent_at: number | null;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
}

/** 규칙 편집기의 「MatNexus 대조」 한 줄. 엔진 타입과 같은 모양이지만 여기 다시 적는다. */
export interface ResolveItem {
  outcome: "unique" | "multiple" | "none";
  label: string;
  /** unique 면 시편 전체 이름, multiple 면 후보 수, none 이면 이유. */
  detail: string;
}

export interface ReferenceMaterial {
  name: string;
  grade: string | null;
  aliases: string[];
  samples: { name: string; lot: string; seq_no: number; specimens: { name: string; short: string; orientation: string | null }[] }[];
}

export interface ConnectionCheck {
  ok: boolean;
  user?: string;
  error?: string;
}

export interface MatPylonApi {
  getStatus(): Promise<EngineStatus>;
  onStatus(listener: (status: EngineStatus) => void): () => void;
  /** 스캔 + 전송을 즉시 한 번. */
  sendNow(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** 설정은 전체를 읽고 전체를 쓴다. 엔진의 Config 와 같은 JSON 모양. */
  getConfig(): Promise<unknown>;
  setConfig(config: unknown): Promise<void>;
  hasToken(): Promise<boolean>;
  setToken(token: string | null): Promise<void>;
  /** 저장 전에 URL·토큰으로 /auth/me 를 불러 본다. */
  testConnection(url: string, tls?: { insecure: boolean; caFile: string | null }): Promise<ConnectionCheck>;
  registerConnector(url: string, name: string, workspaceId: string): Promise<{ id: string }>;
  /** 토큰 주인이 속한 부서 목록. 연결 확인 뒤 마법사가 고르게 한다. */
  listWorkspaces(url: string, tls?: { insecure: boolean; caFile: string | null }): Promise<WorkspaceItem[]>;
  /** 저장된 서버 설정으로. 서버가 없거나 엔드포인트가 없으면(404) null. */
  resolveHints(hints: Record<string, string>[]): Promise<ResolveItem[] | null>;
  /** 이 PC 커넥터의 자동 등록 설정. null = 서버 미연결이거나 구버전(칸 없음) → 토글 숨김. */
  getAutoRegister(): Promise<boolean | null>;
  setAutoRegister(enabled: boolean): Promise<boolean>;
  reference(): Promise<ReferenceMaterial[] | null>;
  listFiles(status?: string): Promise<LedgerRow[]>;
  requeue(id: number): Promise<void>;
  /** 폴더 선택 대화상자. 취소하면 null. */
  pickFolder(): Promise<string | null>;
  /** 파일 선택(CA 인증서). 취소하면 null. */
  pickFile(filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  /** 파일명 규칙 미리보기용 — 폴더의 파일 이름 최대 n개. */
  listFilenames(dir: string, limit: number): Promise<string[]>;
  /** 오늘 로그의 마지막 n줄. */
  logTail(lines: number): Promise<string>;
  openLogFolder(): Promise<void>;
  openDataFolder(): Promise<void>;
  /** 설정을 파일로 — 장비 PC 여러 대에 복제한다. 토큰은 안 들어간다. */
  exportConfig(): Promise<boolean>;
  importConfig(): Promise<boolean>;
  paths(): Promise<{ dataDir: string; configFile: string; logFile: string }>;
  /** 로그인 시 자동 시작. 레지스트리 Run 키 — 관리자 권한 불필요. */
  getAutoLaunch(): Promise<boolean>;
  setAutoLaunch(enabled: boolean): Promise<void>;
}

export const CHANNELS = {
  getStatus: "engine:getStatus",
  status: "engine:status",
  sendNow: "engine:sendNow",
  pause: "engine:pause",
  resume: "engine:resume",
  getConfig: "engine:getConfig",
  setConfig: "engine:setConfig",
  hasToken: "engine:hasToken",
  setToken: "engine:setToken",
  testConnection: "engine:testConnection",
  registerConnector: "engine:registerConnector",
  listWorkspaces: "engine:listWorkspaces",
  resolveHints: "engine:resolveHints",
  getAutoRegister: "engine:getAutoRegister",
  setAutoRegister: "engine:setAutoRegister",
  reference: "engine:reference",
  listFiles: "engine:listFiles",
  requeue: "engine:requeue",
  pickFolder: "app:pickFolder",
  pickFile: "app:pickFile",
  listFilenames: "app:listFilenames",
  logTail: "app:logTail",
  openLogFolder: "app:openLogFolder",
  openDataFolder: "app:openDataFolder",
  exportConfig: "app:exportConfig",
  importConfig: "app:importConfig",
  paths: "app:paths",
  getAutoLaunch: "app:getAutoLaunch",
  setAutoLaunch: "app:setAutoLaunch",
} as const;

declare global {
  interface Window {
    matpylon: MatPylonApi;
  }
}
