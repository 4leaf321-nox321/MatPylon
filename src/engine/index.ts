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
import { extractHints, mergeHints } from "./hints";
import { Ledger, type FileRow } from "./ledger";
import { scanSource } from "./scanner";
import { nextRunAt } from "./scheduler";
import { HASH_MISMATCH, MatNexusClient } from "./matnexus";
import { memorySecrets, type SecretStore } from "./secrets";
import { noTransport, type Transport } from "./transport";

/** 폴더를 못 읽었을 때의 말머리. 화면 오류를 걷을 때 이것으로 알아본다. */
const UNREADABLE = "폴더를 읽지 못했습니다";

export interface EngineOptions {
  appVersion: string;
  /** 설정·원장·로그가 사는 곳(`%APPDATA%\MatPylon`). 엔진은 이 경로를 받기만 한다. */
  dataDir: string;
  /** PAT 보관. Electron 은 safeStorage 로, 테스트는 메모리로. */
  secrets?: SecretStore;
  /** 테스트용 — 주면 설정과 무관하게 이것으로 보낸다. */
  transport?: Transport;
  now?: () => number;
  log?: (msg: string) => void;
}

export class Engine extends EventEmitter {
  private running = false;
  private busy = false;
  private config: Config;
  private readonly ledger: Ledger;
  private transport: Transport;
  readonly secrets: SecretStore;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private scanTimer: NodeJS.Timeout | null = null;
  /** 안정화가 끝나는 시각에 맞춘 일회성 재스캔. 5분 주기를 기다리게 하지 않는다. */
  private rescanTimer: NodeJS.Timeout | null = null;
  private stabilizingUntil: number | null = null;
  /** 「지금 보내기」를 눌렀는데 쓰는 중인 파일이 있었다 — 안정화되면 이어서 보낸다. */
  private sendAfterStabilize = false;
  private sendTimer: NodeJS.Timeout | null = null;
  private lastSendAt: number | null = null;
  private lastPruneAt = 0;
  private lastError: string | null = null;
  /** heartbeat 가 알려 준 서버 한도. 모르면 null — 그냥 보내고 413 을 받는다. */
  private uploadLimit: number | null = null;
  private nextSendAt: number | null = null;

  constructor(private readonly options: EngineOptions) {
    super();
    mkdirSync(options.dataDir, { recursive: true });
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.secrets = options.secrets ?? memorySecrets();
    this.config = loadConfig(options.dataDir);
    this.transport = options.transport ?? this.buildTransport();
    this.ledger = new Ledger(path.join(options.dataDir, "ledger.sqlite"));
    const recovered = this.ledger.recoverSending();
    if (recovered) this.log(`지난 실행에서 보내다 만 ${recovered}건을 다시 대기로`);
    this.maybePrune();
  }

  /** 원장 정리는 하루 한 번. **시작할 때만 돌면 안 된다** — 장비 PC 는 몇 달씩 안 끄므로
   * 보존 기간 설정이 사실상 동작하지 않는다. */
  private maybePrune(): void {
    const now = this.now();
    if (now - this.lastPruneAt < 24 * 3600_000) return;
    this.lastPruneAt = now;
    const pruned = this.ledger.prune(now - this.config.retentionDays * 86_400_000);
    if (pruned) this.log(`보존 기간(${this.config.retentionDays}일) 지난 원장 ${pruned}건 정리`);
  }

  /** 설정 파일이 없던 첫 실행인가. 셸이 자동 시작 기본값을 정할 때 본다. */
  static isFirstRun(dataDir: string): boolean {
    return !existsSync(path.join(dataDir, "config.json"));
  }

  getConfig(): Config {
    return this.config;
  }

  setConfig(config: Config): void {
    saveConfig(this.options.dataDir, config);
    this.config = config;
    if (!this.options.transport) this.transport = this.buildTransport();
    if (this.running) this.arm();
    this.emitStatus();
  }

  setToken(token: string | null): void {
    this.secrets.setToken(token);
    this.emitStatus();
  }

  /** 설정에서 클라이언트를 만든다. 서버 URL 이 없으면 보내지 않는 transport. */
  private buildTransport(): Transport {
    const { url, connectorId, tls } = this.config.server;
    if (!url) return noTransport;
    return new MatNexusClient({ baseUrl: url, secrets: this.secrets, connectorId, tls });
  }

  /** 화면의 「연결 확인」·커넥터 등록이 쓴다. 설정과 무관한 URL 로도 부를 수 있어야
   * 마법사에서 저장 전에 확인한다. */
  client(
    url = this.config.server.url,
    connectorId = this.config.server.connectorId,
    tls = this.config.server.tls,
  ): MatNexusClient {
    if (!url) throw new Error("서버 URL 이 없습니다");
    return new MatNexusClient({ baseUrl: url, secrets: this.secrets, connectorId, tls });
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
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.scanTimer = this.sendTimer = this.rescanTimer = null;
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
    this.maybePrune();
    let unreadable: string | null = null;
    for (const source of this.config.sources) {
      if (!source.enabled) continue;
      const r = await scanSource(source, this.ledger, this.now(), this.log);
      if (r.unreadable) unreadable = `[${source.name}] ${r.errors[0] ?? UNREADABLE}`;
      if (r.ready || r.duplicate || r.gone || r.errors.length)
        this.log(
          `[${source.key}] 본 것 ${r.observed} · 준비 ${r.ready} · 중복 ${r.duplicate} · 사라짐 ${r.gone}` +
            (r.errors.length ? ` · 오류 ${r.errors.length}` : ""),
        );
      for (const e of r.errors) this.log(`  ${e}`);
    }
    // 폴더가 안 읽히면 수집이 통째로 멈춘다. 조용히 지나가면 아무도 모른 채 며칠이 간다 —
    // 화면과 트레이 알림에 띄운다. 다시 읽히면 스스로 걷는다.
    if (unreadable) this.lastError = unreadable;
    else if (this.lastError?.includes(UNREADABLE)) this.lastError = null;
    this.armRescan();
    // 「지금 보내기」가 쓰는 중인 파일에 막혀 있었다면, 대기로 넘어온 지금 이어서 보낸다.
    if (this.sendAfterStabilize && this.ledger.due(this.now()).length > 0) {
      this.sendAfterStabilize = false;
      void this.send();
      return;
    }
    this.emitStatus();
  }

  /** 안정화가 끝나는 가장 이른 시각에 재스캔을 예약한다. 5분 스캔 주기와 별개다 —
   * "1분이면 보낸다더니 아무 일도 없다" 를 없앤다. */
  private armRescan(): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = null;
    let earliest: number | null = null;
    for (const source of this.config.sources) {
      if (!source.enabled) continue;
      for (const row of this.ledger.pendingBySource(source.key)) {
        if (row.status !== "seen") continue;
        const at = Math.max(row.observed_at, row.mtime_ms) + source.stableMinutes * 60_000;
        if (earliest === null || at < earliest) earliest = at;
      }
    }
    this.stabilizingUntil = earliest;
    if (earliest !== null && this.running) {
      const delay = Math.max(earliest - this.now() + 1000, 1000);
      this.rescanTimer = setTimeout(() => void this.scan(), delay);
    }
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
      for (const row of this.ledger.due(this.now())) {
        const halted = await this.deliverOne(row);
        if (halted) break;
      }
      await this.heartbeat();
    } finally {
      this.busy = false;
      if (this.running) this.arm();
      this.emitStatus();
    }
  }

  async sendNow(): Promise<void> {
    await this.scan();
    await this.send();
    // 쓰는 중인 파일이 남았으면, 안정화 재스캔이 끝나는 대로 이어서 보낸다.
    if (this.ledger.counts().seen > 0) {
      this.sendAfterStabilize = true;
      this.log("쓰는 중인 파일이 있어, 안정화되면 이어서 보냅니다");
      this.emitStatus();
    }
  }

  /** true 면 배치를 멈춘다(halt). */
  private async deliverOne(row: FileRow): Promise<boolean> {
    const source = this.config.sources.find((s) => s.key === row.source_key);
    if (!source) {
      this.ledger.markFailed(row.id, "설정에 없는 소스입니다");
      return false;
    }
    // 서버 한도를 알면 보내기 전에 거른다 — 413 을 받으려고 100MB 를 올리지 않는다.
    if (this.uploadLimit !== null && row.size > this.uploadLimit) {
      this.ledger.markFailed(
        row.id,
        `서버 한도(${Math.round(this.uploadLimit / 1048576)}MB)보다 큽니다`,
      );
      return false;
    }
    this.ledger.claim(row.id);
    const result = await this.transport.deliver({
      sourceKey: row.source_key,
      path: row.path,
      sha256: row.sha256!,
      mtimeMs: row.mtime_ms,
      hints: mergeHints(source.defaults, extractHints(source.filenameRule, path.basename(row.path))),
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
        // 해시 불일치는 한 번만 더 본다. 두 번 깨지면 전송이 아니라 파일이 문제다.
        if (result.error.startsWith(HASH_MISMATCH) && row.attempts >= 1) {
          this.ledger.markFailed(row.id, `${result.error} (재전송해도 같음)`);
          this.log(`실패(해시 불일치 2회): ${row.path}`);
          break;
        }
        this.ledger.markRetry(row.id, result.error, this.now());
        this.log(`나중에 다시: ${row.path} — ${result.error}`);
        break;
      case "halt":
        this.ledger.markRetry(row.id, result.error, this.now());
        this.lastError = result.error;
        this.log(`전송 중단: ${result.error}`);
        return true;
    }
    return false;
  }

  /** 상태 보고. 실패해도 전송과 무관하다 — 로그만 남긴다. */
  private async heartbeat(): Promise<void> {
    if (!(this.transport instanceof MatNexusClient) || !this.transport.configured()) return;
    const sources = this.config.sources.map((s) => {
      const st = this.ledger.sourceStats(s.key);
      return {
        key: s.key,
        pending: st.pending,
        failed: st.failed,
        last_sent_at: st.lastSentAt ? new Date(st.lastSentAt).toISOString() : null,
      };
    });
    try {
      const out = await this.transport.heartbeat({
        app_version: this.options.appVersion,
        sources,
        next_run_at: this.nextSendAt ? new Date(this.nextSendAt).toISOString() : null,
      });
      if (typeof out.upload_limit_bytes === "number") this.uploadLimit = out.upload_limit_bytes;
      this.lastError = null;
    } catch (e) {
      this.lastError = `heartbeat 실패: ${(e as Error).message}`;
      this.log(this.lastError);
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
      lastError: this.lastError,
      nextRunAt: this.running && this.nextSendAt ? new Date(this.nextSendAt).toISOString() : null,
      counts: { seen: c.seen, ready: c.ready + c.retry, sent: c.sent, failed: c.failed },
      stabilizingUntil: this.stabilizingUntil ? new Date(this.stabilizingUntil).toISOString() : null,
    };
  }

  private emitStatus(): void {
    this.emit("status", this.status());
  }
}
