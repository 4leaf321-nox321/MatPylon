/** 엔진 — Electron 을 모르는 순수 Node.
 *
 * 스캔·안정화·해시·원장·스케줄·전송이 전부 여기에 산다. 이 폴더가 `electron` 을
 * import 하면 `tests/architecture` 가 막는다 — 서비스 모드가 필요해지면 이 폴더만
 * 떼어 내야 하기 때문이다(개발계획 §2).
 *
 * 두 개의 박자가 있다.
 *   스캔  scanMinutes 마다 (기본 5분)  — 폴더를 훑어 원장에 적는다
 *   전송  schedule 대로 (기본 1시간)   — 원장의 due 를 보낸다
 * 「지금 보내기」는 둘을 즉시 한 번 돈다. */

import { EventEmitter } from "node:events";
import { mkdirSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import type { EngineStatus } from "@shared/ipc";
import { loadConfig, saveConfig, type Config } from "./config";
import { extractHints } from "./hints";
import { Ledger, type FileRow } from "./ledger";
import { scanSource } from "./scanner";
import { nextRunAt } from "./scheduler";
import { noTransport, type Transport } from "./transport";

export interface EngineOptions {
  appVersion: string;
  /** 설정·원장·로그가 사는 곳(`%APPDATA%\MatPylon`). 엔진은 이 경로를 받기만 한다. */
  dataDir: string;
  transport?: Transport;
  now?: () => number;
  log?: (msg: string) => void;
}

export class Engine extends EventEmitter {
  private running = false;
  private busy = false;
  private config: Config;
  private readonly ledger: Ledger;
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private scanTimer: NodeJS.Timeout | null = null;
  private sendTimer: NodeJS.Timeout | null = null;
  private lastSendAt: number | null = null;
  private nextSendAt: number | null = null;

  constructor(private readonly options: EngineOptions) {
    super();
    mkdirSync(options.dataDir, { recursive: true });
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.transport = options.transport ?? noTransport;
    this.config = loadConfig(options.dataDir);
    this.ledger = new Ledger(path.join(options.dataDir, "ledger.sqlite"));
    const recovered = this.ledger.recoverSending();
    if (recovered) this.log(`지난 실행에서 보내다 만 ${recovered}건을 다시 대기로`);
  }

  getConfig(): Config {
    return this.config;
  }

  setConfig(config: Config): void {
    saveConfig(this.options.dataDir, config);
    this.config = config;
    if (this.running) this.arm();
    this.emitStatus();
  }

  start(): void {
    this.running = true;
    this.arm();
    this.emitStatus();
  }

  stop(): void {
    this.running = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.scanTimer = this.sendTimer = null;
    this.emitStatus();
  }

  close(): void {
    this.stop();
    this.ledger.close();
  }

  /** 타이머를 설정에 맞춰 다시 잡는다. */
  private arm(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.scanTimer = setInterval(() => void this.scan(), this.config.scanMinutes * 60_000);
    this.nextSendAt = nextRunAt(this.config.schedule, this.lastSendAt, this.now());
    // setTimeout 상한(~24.8일)은 daily 로도 안 넘지만, 절전 복귀 뒤 밀린 것을 잡으려면
    // 짧게 깨어 확인하는 편이 낫다.
    const delay = Math.min(this.nextSendAt - this.now(), 15 * 60_000);
    this.sendTimer = setTimeout(() => {
      if (this.now() >= (this.nextSendAt ?? 0)) void this.send();
      else this.arm();
    }, Math.max(delay, 1000));
    void this.scan();
  }

  async scan(): Promise<void> {
    for (const source of this.config.sources) {
      if (!source.enabled) continue;
      const r = await scanSource(source, this.ledger, this.now(), this.log);
      if (r.ready || r.duplicate || r.gone || r.errors.length)
        this.log(
          `[${source.key}] 본 것 ${r.observed} · 준비 ${r.ready} · 중복 ${r.duplicate} · 사라짐 ${r.gone}` +
            (r.errors.length ? ` · 오류 ${r.errors.length}` : ""),
        );
      for (const e of r.errors) this.log(`  ${e}`);
    }
    this.emitStatus();
  }

  /** 원장의 due 를 보낸다. 파일 1 = 요청 1 — 부분 실패를 건별로. */
  async send(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.lastSendAt = this.now();
      if (!this.transport.configured()) {
        this.log("서버가 설정되지 않아 보내지 않습니다");
        return;
      }
      for (const row of this.ledger.due(this.now())) await this.deliverOne(row);
    } finally {
      this.busy = false;
      if (this.running) this.arm();
      this.emitStatus();
    }
  }

  async sendNow(): Promise<void> {
    await this.scan();
    await this.send();
  }

  private async deliverOne(row: FileRow): Promise<void> {
    const source = this.config.sources.find((s) => s.key === row.source_key);
    if (!source) {
      this.ledger.markFailed(row.id, "설정에 없는 소스입니다");
      return;
    }
    this.ledger.claim(row.id);
    const result = await this.transport.deliver({
      sourceKey: row.source_key,
      path: row.path,
      sha256: row.sha256!,
      mtimeMs: row.mtime_ms,
      hints: extractHints(source.filenameRule, path.basename(row.path)),
    });
    switch (result.kind) {
      case "sent":
        this.ledger.markSent(row.id, result.serverId, this.now());
        this.log(`보냄: ${row.path}`);
        if (source.moveAfterSendTo) this.moveSent(row.path, source);
        break;
      case "rejected":
        this.ledger.markFailed(row.id, result.error);
        this.log(`실패(재시도 안 함): ${row.path} — ${result.error}`);
        break;
      case "retry":
        this.ledger.markRetry(row.id, result.error, this.now());
        this.log(`나중에 다시: ${row.path} — ${result.error}`);
        break;
    }
  }

  /** 결정 D: 옮기는 것은 `sent` 가 된 뒤에만, 옵션이 켜진 소스만. */
  private moveSent(file: string, source: { path: string; moveAfterSendTo: string | null }): void {
    try {
      const dir = path.join(path.dirname(file), source.moveAfterSendTo!);
      mkdirSync(dir, { recursive: true });
      let target = path.join(dir, path.basename(file));
      if (existsSync(target)) {
        const { name, ext } = path.parse(target);
        target = path.join(dir, `${name}.${this.now()}${ext}`);
      }
      renameSync(file, target);
    } catch (e) {
      this.log(`옮기기 실패(보내기는 됐음): ${file} — ${(e as Error).message}`);
    }
  }

  requeue(id: number): void {
    this.ledger.requeue(id);
    this.emitStatus();
  }

  files(status?: FileRow["status"]) {
    return this.ledger.list(status);
  }

  status(): EngineStatus {
    const c = this.ledger.counts();
    return {
      appVersion: this.options.appVersion,
      running: this.running,
      serverConfigured: this.transport.configured(),
      nextRunAt: this.running && this.nextSendAt ? new Date(this.nextSendAt).toISOString() : null,
      counts: { ready: c.ready + c.retry, sent: c.sent, failed: c.failed },
    };
  }

  private emitStatus(): void {
    this.emit("status", this.status());
  }
}
