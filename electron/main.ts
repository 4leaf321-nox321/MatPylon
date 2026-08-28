import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from "electron";
import log from "electron-log/main";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "@engine/index";
import { configPath, parseConfig } from "@engine/config";
import { CHANNELS } from "@shared/ipc";
import { fileSecrets } from "./secrets";

// 개발용: `--data-dir=경로` 로 설정·원장·잠금을 다른 곳에 둔다. 설치된 앱이 떠 있는
// 채로 개발 빌드를 띄워 보려면 이것이 필요하다 — 잠금이 userData 에 걸린다.
const dataDirArg = process.argv.find((a) => a.startsWith("--data-dir="))?.slice("--data-dir=".length);
if (dataDirArg) app.setPath("userData", dataDirArg);

// 인스턴스 하나. 트레이 앱이 둘 뜨면 같은 폴더를 두 번 보낸다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

log.initialize();
log.transports.file.level = "info";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// safeStorage 는 app ready 뒤에만 쓸 수 있다 — 엔진은 ready 안에서 만든다.
let engine!: Engine;

function createWindow(): BrowserWindow {
  // 마법사 첫 화면이 스크롤 없이 들어가는 크기. 화면이 더 작으면 작업 영역에 맞춘다.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const w = new BrowserWindow({
    width: Math.min(1120, area.width),
    height: Math.min(980, area.height),
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void w.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void w.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  // 닫기는 트레이로 내려가기다(개발계획 §6). 종료는 트레이 메뉴에서만.
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  w.once("ready-to-show", () => w.show());
  // 개발용: `--screenshot=경로` 로 띄우면 화면을 찍고 종료한다. 바탕화면을 찍지 않고
  // 창 자체를 찍으므로 다른 창에 가려도 된다.
  const shot = process.argv.find((a) => a.startsWith("--screenshot="))?.slice("--screenshot=".length);
  if (shot) {
    w.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const img = await w.webContents.capturePage();
        require("node:fs").writeFileSync(shot, img.toPNG());
        quitting = true;
        app.quit();
      }, 1500);
    });
  }
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow();
  else {
    win.show();
    win.focus();
  }
}

function trayIcon() {
  // 16x16 단색 아이콘을 코드로 만든다 — P0 에서는 자산 파일 없이 뜨는 것이 목적.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = x >= 3 && x < 13 && y >= 3 && y < 13 && !(x >= 6 && x < 10 && y >= 6);
      buf[i] = 30; buf[i + 1] = 120; buf[i + 2] = 200; buf[i + 3] = on ? 255 : 0;
    }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function buildTrayMenu(): void {
  const s = engine.status();
  const menu = Menu.buildFromTemplate([
    { label: s.running ? "동작 중" : "일시 정지됨", enabled: false },
    { type: "separator" },
    { label: "설정 열기", click: showWindow },
    { label: "지금 보내기", click: () => void engine.sendNow() },
    {
      label: s.running ? "일시 정지" : "다시 시작",
      click: () => (s.running ? engine.stop() : engine.start()),
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray?.setContextMenu(menu);
  tray?.setToolTip(
    `MatPylon ${s.appVersion} — ${s.running ? "동작 중" : "일시 정지"}` +
      ` · 대기 ${s.counts.ready} · 실패 ${s.counts.failed}`,
  );
}

app.whenReady().then(() => {
  // 첫 실행이면 자동 시작을 켠다 — 트레이 상주 앱이 로그인 뒤 안 떠 있으면 아무것도 안 보낸다.
  // 사용자가 「정보」에서 끄면 그 뒤로는 건드리지 않는다(설정 파일이 생기므로).
  if (Engine.isFirstRun(app.getPath("userData")) && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
  engine = new Engine({
    appVersion: app.getVersion(),
    dataDir: app.getPath("userData"),
    secrets: fileSecrets(app.getPath("userData")),
    log: (msg) => log.info(msg),
  });
  tray = new Tray(trayIcon());
  tray.on("double-click", showWindow);
  buildTrayMenu();

  let notifiedError: string | null = null;
  engine.on("status", (status) => {
    buildTrayMenu();
    // 전송이 멈춘 이유는 창을 안 열어도 보여야 한다. 같은 오류는 한 번만.
    if (status.lastError && status.lastError !== notifiedError && Notification.isSupported()) {
      new Notification({ title: "MatPylon — 전송 중단", body: status.lastError }).show();
    }
    notifiedError = status.lastError;
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CHANNELS.status, status);
  });

  ipcMain.handle(CHANNELS.getStatus, () => engine.status());
  ipcMain.handle(CHANNELS.sendNow, () => engine.sendNow());
  ipcMain.handle(CHANNELS.pause, () => engine.stop());
  ipcMain.handle(CHANNELS.resume, () => engine.start());
  ipcMain.handle(CHANNELS.getConfig, () => engine.getConfig());
  ipcMain.handle(CHANNELS.setConfig, (_e, config: unknown) => engine.setConfig(parseConfig(config)));
  ipcMain.handle(CHANNELS.hasToken, () => engine.secrets.getToken() !== null);
  ipcMain.handle(CHANNELS.setToken, (_e, token: string | null) => engine.setToken(token));
  ipcMain.handle(CHANNELS.testConnection, async (_e, url: string, tls?: { insecure: boolean; caFile: string | null }) => {
    try {
      const me = await engine.client(url, null, tls).me();
      return { ok: true, user: me.display_name ?? me.email ?? me.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle(CHANNELS.registerConnector, async (_e, url: string, name: string, ws: string) => {
    const out = await engine.client(url, null).registerConnector(name, os.hostname(), ws);
    return { id: out.id };
  });
  ipcMain.handle(CHANNELS.listWorkspaces, async (_e, url: string, tls?: { insecure: boolean; caFile: string | null }) => {
    const list = await engine.client(url, null, tls).listWorkspaces();
    return list.map((w) => ({ id: w.id, name: w.name, path: w.path, is_active: w.is_active }));
  });
  // 규칙 편집기의 대조·참조. 서버가 없거나 저쪽에 아직 엔드포인트가 없으면 null — 화면은 힌트만 보인다.
  const workspaceOf = async () => {
    const c = engine.getConfig();
    if (!c.server.url || !c.server.connectorId || !engine.secrets.getToken()) return null;
    const mine = await engine.client().listConnectors();
    return mine.find((x) => x.id === c.server.connectorId)?.workspace_id ?? null;
  };
  ipcMain.handle(CHANNELS.resolveHints, async (_e, hints: Record<string, string>[]) => {
    try {
      const ws = await workspaceOf();
      if (!ws) return null;
      const results = await engine.client().resolve(ws, hints);
      return results.map((r) => ({
        outcome: r.outcome,
        label: r.outcome === "unique" ? "자동 등록" : r.outcome === "multiple" ? `후보 ${r.candidates.length}개` : "수집함행",
        detail:
          r.outcome === "unique"
            ? (r.candidate?.specimen_name ?? "")
            : r.outcome === "multiple"
              ? r.candidates.map((c) => c.specimen_name).join(", ")
              : (r.reason ?? ""),
      }));
    } catch (e) {
      log.warn("resolve 실패: %s", (e as Error).message);
      return null;
    }
  });
  ipcMain.handle(CHANNELS.reference, async () => {
    try {
      const ws = await workspaceOf();
      if (!ws) return null;
      const tree = await engine.client().reference(ws);
      return tree.materials.map((m) => ({
        name: m.name,
        grade: m.grade,
        aliases: m.aliases,
        samples: m.samples.map((s) => ({
          name: s.name,
          lot: s.lot,
          seq_no: s.seq_no,
          specimens: s.specimens.map((p) => ({ name: p.name, short: p.short, orientation: p.orientation })),
        })),
      }));
    } catch (e) {
      log.warn("reference 실패: %s", (e as Error).message);
      return null;
    }
  });
  ipcMain.handle(CHANNELS.listFiles, (_e, status?: string) =>
    engine.files(status as Parameters<Engine["files"]>[0]),
  );
  ipcMain.handle(CHANNELS.requeue, (_e, id: number) => engine.requeue(id));
  ipcMain.handle(CHANNELS.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(CHANNELS.pickFile, async (_e, filters: { name: string; extensions: string[] }[]) => {
    const r = await dialog.showOpenDialog({ properties: ["openFile"], filters });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(CHANNELS.listFilenames, (_e, dir: string, limit: number) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .slice(0, limit);
    } catch {
      return [];
    }
  });
  const logFile = () => log.transports.file.getFile().path;
  ipcMain.handle(CHANNELS.logTail, (_e, lines: number) => {
    try {
      return readFileSync(logFile(), "utf8").split(/\r?\n/).slice(-lines).join("\n");
    } catch {
      return "";
    }
  });
  ipcMain.handle(CHANNELS.openLogFolder, () => shell.showItemInFolder(logFile()));
  ipcMain.handle(CHANNELS.openDataFolder, () => shell.openPath(app.getPath("userData")));
  ipcMain.handle(CHANNELS.paths, () => ({
    dataDir: app.getPath("userData"),
    configFile: configPath(app.getPath("userData")),
    logFile: logFile(),
  }));
  ipcMain.handle(CHANNELS.exportConfig, async () => {
    const r = await dialog.showSaveDialog({
      defaultPath: `matpylon-${os.hostname()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return false;
    // 커넥터 id 는 이 PC 의 것이다 — 복제본에는 넣지 않는다.
    const c = engine.getConfig();
    const out = { ...c, server: { ...c.server, connectorId: null, connectorName: "" } };
    writeFileSync(r.filePath, JSON.stringify(out, null, 2), "utf8");
    return true;
  });
  ipcMain.handle(CHANNELS.importConfig, async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const file = r.filePaths[0];
    if (r.canceled || !file) return false;
    const incoming = parseConfig(JSON.parse(readFileSync(file, "utf8")));
    // 서버 URL·소스·스케줄은 가져오고, 커넥터 id 는 이 PC 것을 지킨다.
    const mine = engine.getConfig();
    engine.setConfig({ ...incoming, server: { ...incoming.server, connectorId: mine.server.connectorId, connectorName: mine.server.connectorName } });
    return true;
  });
  ipcMain.handle(CHANNELS.getAutoLaunch, () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle(CHANNELS.setAutoLaunch, (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  engine.start();
  showWindow();
  log.info("MatPylon %s 시작 · dataDir=%s", app.getVersion(), app.getPath("userData"));
});

app.on("second-instance", showWindow);
// 트레이 앱이다 — 창이 다 닫혀도 살아 있어야 한다.
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  quitting = true;
  engine?.close();
});
