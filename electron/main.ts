import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from "electron";
import log from "electron-log/main";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "@engine/index";
import { parseConfig } from "@engine/config";
import { CHANNELS } from "@shared/ipc";
import { fileSecrets } from "./secrets";

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
  const w = new BrowserWindow({
    width: 1000,
    height: 700,
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
  tray?.setToolTip(`MatPylon ${s.appVersion} — ${s.running ? "동작 중" : "일시 정지"}`);
}

app.whenReady().then(() => {
  engine = new Engine({
    appVersion: app.getVersion(),
    dataDir: app.getPath("userData"),
    secrets: fileSecrets(app.getPath("userData")),
    log: (msg) => log.info(msg),
  });
  tray = new Tray(trayIcon());
  tray.on("double-click", showWindow);
  buildTrayMenu();

  engine.on("status", (status) => {
    buildTrayMenu();
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
  ipcMain.handle(CHANNELS.testConnection, async (_e, url: string) => {
    try {
      const me = await engine.client(url, null).me();
      return { ok: true, user: me.display_name ?? me.email ?? me.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle(CHANNELS.registerConnector, async (_e, url: string, name: string, ws: string) => {
    const out = await engine.client(url, null).registerConnector(name, os.hostname(), ws);
    return { id: out.id };
  });
  ipcMain.handle(CHANNELS.listFiles, (_e, status?: string) =>
    engine.files(status as Parameters<Engine["files"]>[0]),
  );
  ipcMain.handle(CHANNELS.requeue, (_e, id: number) => engine.requeue(id));
  ipcMain.handle(CHANNELS.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
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
