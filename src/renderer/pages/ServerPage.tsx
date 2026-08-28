import { useEffect, useState } from "react";
import type { Config } from "@engine/config";
import { useConfig } from "../hooks";
import { Badge, Button, Card, Field, Input } from "../ui";

/** 서버 URL · PAT · 커넥터. 마법사도 이 폼을 그대로 쓴다. */
export function ServerForm({
  config,
  onSaved,
}: {
  config: Config;
  onSaved: (next: Config) => Promise<string | null>;
}) {
  const [url, setUrl] = useState(config.server.url ?? "");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [connectorName, setConnectorName] = useState(config.server.connectorName || defaultConnectorName());
  const [workspaceId, setWorkspaceId] = useState("");
  const [tls, setTls] = useState(config.server.tls);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.matpylon.hasToken().then(setHasToken);
  }, []);

  const saveToken = async () => {
    if (!token.trim()) return;
    await window.matpylon.setToken(token.trim());
    setToken("");
    setHasToken(true);
  };

  const test = async () => {
    setBusy(true);
    setCheck(null);
    try {
      if (token.trim()) await saveToken();
      const r = await window.matpylon.testConnection(url.trim(), tls);
      setCheck(r.ok ? { ok: true, text: `연결됨 — ${r.user}` } : { ok: false, text: r.error ?? "실패" });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setMsg(null);
    if (token.trim()) await saveToken();
    const err = await onSaved({
      ...config,
      server: { ...config.server, url: url.trim() || null, connectorName, tls },
    });
    setMsg(err ?? "저장했습니다");
  };

  const register = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { id } = await window.matpylon.registerConnector(url.trim(), connectorName, workspaceId.trim());
      const err = await onSaved({
        ...config,
        server: { url: url.trim(), connectorId: id, connectorName, tls },
      });
      setMsg(err ?? `커넥터를 등록했습니다: ${id}`);
    } catch (e) {
      setMsg((e as Error).message.replace(/^.*Error: /, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="MatNexus 서버">
        <div className="space-y-3">
          <Field label="서버 주소" hint="예: http://matnexus.local:8010 — /api 는 붙이지 않습니다">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://서버:8010" />
          </Field>
          <Field
            label="개인 액세스 토큰(PAT)"
            hint="MatNexus 에서 「내 계정 → 토큰」 으로 발급. 이 PC 에 암호화되어 저장되고 다시 보여 주지 않습니다."
          >
            <div className="flex gap-2">
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasToken ? "저장됨 — 바꾸려면 새 토큰 입력" : "mnx_pat_…"}
              />
              {hasToken && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    await window.matpylon.setToken(null);
                    setHasToken(false);
                  }}
                >
                  지우기
                </Button>
              )}
            </div>
          </Field>
          {url.trim().startsWith("https://") && (
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-600">HTTPS 인증서</div>
              <Field label="사내 CA 인증서 파일(PEM)" hint="서버 인증서를 발급한 사내 CA. 있으면 이것으로 검증합니다">
                <div className="flex gap-2">
                  <Input value={tls.caFile ?? ""} onChange={(e) => setTls({ ...tls, caFile: e.target.value || null })} />
                  <Button
                    onClick={async () => {
                      const f = await window.matpylon.pickFile([{ name: "인증서", extensions: ["pem", "crt", "cer"] }]);
                      if (f) setTls({ ...tls, caFile: f });
                    }}
                  >
                    찾기
                  </Button>
                </div>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={tls.insecure} onChange={(e) => setTls({ ...tls, insecure: e.target.checked })} />
                인증서 검증 끄기
              </label>
              {tls.insecure && (
                <p className="text-xs text-amber-700">
                  검증을 끄면 중간자가 토큰을 가로챌 수 있습니다. CA 파일을 받을 수 없을 때만, 폐쇄망 안에서만 쓰세요.
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button disabled={busy || !url.trim()} onClick={test}>
              연결 확인
            </Button>
            {check && <Badge tone={check.ok ? "ok" : "bad"}>{check.text}</Badge>}
          </div>
        </div>
      </Card>

      <Card title="커넥터 (이 PC)">
        <div className="space-y-3">
          <Field label="커넥터 이름" hint="관리 화면에서 이 PC 를 알아볼 이름. 예: 인장기-1 (2공장)">
            <Input value={connectorName} onChange={(e) => setConnectorName(e.target.value)} />
          </Field>
          {config.server.connectorId ? (
            <p className="text-sm">
              등록됨 <span className="font-mono text-xs text-slate-500">{config.server.connectorId}</span>
            </p>
          ) : (
            <>
              <Field label="부서(워크스페이스) ID" hint="MatNexus 관리 화면의 부서 정보에서 복사">
                <Input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
              </Field>
              <Button
                variant="primary"
                disabled={busy || !url.trim() || !hasToken || !workspaceId.trim() || !connectorName.trim()}
                onClick={register}
              >
                커넥터 등록
              </Button>
            </>
          )}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save}>
          저장
        </Button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}

function defaultConnectorName() {
  return "";
}

export function ServerPage() {
  const { config, save } = useConfig();
  if (!config) return null;
  return <ServerForm config={config} onSaved={save} />;
}
