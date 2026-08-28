# MatPylon

시험장비 PC 에 설치하는 수집 에이전트. 장비가 떨어뜨리는 파일을 감시해
[MatNexus](https://github.com/4leaf321-nox321/MatNexus) 에 주기적으로 배달한다.

- 계획: [docs/개발계획.md](docs/개발계획.md)
- 파싱은 하지 않는다 — MatNexus 가 형식 프로파일로 읽는다. 이 앱은 배달부다.

## 개발

```powershell
npm install
npm run dev          # Vite + Electron 개발 실행
npm run typecheck ; npm test ; npm run build
npm run package      # release\MatPylon-Setup-x.y.z.exe
```

설정·원장·로그는 `%APPDATA%\MatPylon\` 에 산다.

**VSCode 터미널에서 exe 가 바로 꺼지면** `ELECTRON_RUN_AS_NODE` 를 본다. Claude Code 등
VSCode 확장 터미널은 이 변수를 `1` 로 두는데, 그러면 Electron 이 GUI 없이 Node 로
뜨고 `bad option` 만 남기고 나간다. 실측: `alive=False`, 로그 없음.
`env -u ELECTRON_RUN_AS_NODE ./MatPylon.exe` 로 띄운다.

**`better-sqlite3` 는 두 ABI 사이를 오간다.** `npm run package` 가 Electron ABI 로
리빌드하고 나면 Node 의 vitest 가 `NODE_MODULE_VERSION 130 vs 115` 로 못 연다. 그래서
`pretest` 가 Node 용으로, `predev` 가 Electron 용으로 매번 되돌린다. 테스트가 그
오류로 죽으면 `npm rebuild better-sqlite3` 다.
