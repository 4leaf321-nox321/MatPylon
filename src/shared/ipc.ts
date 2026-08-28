/** 렌더러 ↔ 메인 IPC 계약. 양쪽이 이 파일 하나를 본다 — 채널 이름을 문자열로
 * 흩어 두면 한쪽만 고쳐진다. */

export interface EngineStatus {
  appVersion: string;
  /** 엔진이 돌고 있는가(일시 정지 아님). */
  running: boolean;
  serverConfigured: boolean;
  nextRunAt: string | null;
  counts: { ready: number; sent: number; failed: number };
}

export interface MatPylonApi {
  getStatus(): Promise<EngineStatus>;
  onStatus(listener: (status: EngineStatus) => void): () => void;
  /** 로그인 시 자동 시작. 레지스트리 Run 키 — 관리자 권한 불필요. */
  getAutoLaunch(): Promise<boolean>;
  setAutoLaunch(enabled: boolean): Promise<void>;
}

export const CHANNELS = {
  getStatus: "engine:getStatus",
  status: "engine:status",
  getAutoLaunch: "app:getAutoLaunch",
  setAutoLaunch: "app:setAutoLaunch",
} as const;

declare global {
  interface Window {
    matpylon: MatPylonApi;
  }
}
