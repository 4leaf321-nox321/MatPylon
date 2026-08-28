/** 엔진 — Electron 을 모르는 순수 Node.
 *
 * 스캔·안정화·해시·원장·스케줄·전송·heartbeat 가 전부 여기에 산다. 이 폴더가
 * `electron` 을 import 하면 `tests/architecture` 가 막는다 — 서비스 모드가
 * 필요해지면 이 폴더만 떼어 내야 하기 때문이다(개발계획 §2).
 *
 * P0 에서는 상태를 들고 있는 껍데기만 둔다. P1 에서 채운다. */

import { EventEmitter } from "node:events";
import type { EngineStatus } from "@shared/ipc";

export interface EngineOptions {
  appVersion: string;
  /** 설정·원장·로그가 사는 곳(`%APPDATA%\MatPylon`). 엔진은 이 경로를 받기만 한다. */
  dataDir: string;
}

export class Engine extends EventEmitter {
  private running = false;

  constructor(private readonly options: EngineOptions) {
    super();
  }

  start(): void {
    this.running = true;
    this.emit("status", this.status());
  }

  stop(): void {
    this.running = false;
    this.emit("status", this.status());
  }

  status(): EngineStatus {
    return {
      appVersion: this.options.appVersion,
      running: this.running,
      serverConfigured: false,
      nextRunAt: null,
      counts: { ready: 0, sent: 0, failed: 0 },
    };
  }
}
