import { useEffect, useMemo, useState } from "react";
import type { Config, Source } from "@engine/config";
import { HINT_KEYS } from "@shared/hint-keys";
import { checkRule, extractHints } from "@engine/hints";
import { useConfig } from "../hooks";
import { Badge, Button, Card, Field, Input, Toggle } from "../ui";

const EMPTY: Source = {
  key: "",
  name: "",
  path: "",
  extensions: [],
  recursive: false,
  stableMinutes: 2,
  filenameRule: null,
  moveAfterSendTo: null,
  enabled: true,
};

export function SourcesPage() {
  const { config, save } = useConfig();
  const [editing, setEditing] = useState<Source | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!config) return null;

  const commit = async (next: Config) => {
    const err = await save(next);
    setMsg(err);
    if (!err) setEditing(null);
  };

  if (editing)
    return (
      <SourceEditor
        source={editing}
        isNew={isNew}
        existingKeys={config.sources.filter((s) => s !== editing).map((s) => s.key)}
        error={msg}
        onCancel={() => {
          setEditing(null);
          setMsg(null);
        }}
        onSave={(s) => {
          const sources = isNew
            ? [...config.sources, s]
            : config.sources.map((x) => (x.key === editing.key ? s : x));
          void commit({ ...config, sources });
        }}
      />
    );

  return (
    <Card
      title="소스 폴더"
      actions={
        <Button
          variant="primary"
          onClick={() => {
            setEditing({ ...EMPTY });
            setIsNew(true);
          }}
        >
          추가
        </Button>
      }
    >
      {config.sources.length === 0 && (
        <p className="text-sm text-slate-400">장비가 파일을 떨어뜨리는 폴더를 등록하세요. 장비 하나가 소스 하나입니다.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {config.sources.map((s) => (
          <li key={s.key} className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium">
                {s.name} <span className="font-mono text-xs text-slate-400">{s.key}</span>{" "}
                {!s.enabled && <Badge tone="muted">꺼짐</Badge>}
              </div>
              <div className="font-mono text-xs text-slate-500">{s.path}</div>
              <div className="text-xs text-slate-500">
                {s.extensions.join(" ") || "모든 확장자"} · 안정화 {s.stableMinutes}분
                {s.recursive && " · 하위 폴더 포함"}
                {s.moveAfterSendTo && ` · 보낸 뒤 ${s.moveAfterSendTo}\\ 로 이동`}
                {s.filenameRule && " · 파일명 규칙"}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setEditing(s);
                  setIsNew(false);
                }}
              >
                편집
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm(`소스 「${s.name}」 을 지울까요? 원장의 기록은 남습니다.`))
                    void commit({ ...config, sources: config.sources.filter((x) => x.key !== s.key) });
                }}
              >
                삭제
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
    </Card>
  );
}

function slugKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/[가-힣]+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function SourceEditor({
  source,
  isNew,
  existingKeys,
  error,
  onSave,
  onCancel,
}: {
  source: Source;
  isNew: boolean;
  existingKeys: string[];
  error: string | null;
  onSave: (s: Source) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<Source>(source);
  const [ext, setExt] = useState(source.extensions.join(" "));
  const [rule, setRule] = useState(source.filenameRule ?? "");
  const [move, setMove] = useState(source.moveAfterSendTo ?? "");
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    if (s.path) void window.matpylon.listFilenames(s.path, 20).then(setNames);
    else setNames([]);
  }, [s.path]);

  const ruleCheck = useMemo(() => (rule ? checkRule(rule) : null), [rule]);
  const preview = useMemo(
    () => names.map((n) => ({ n, hints: extractHints(rule || null, n) })),
    [names, rule],
  );
  const keyTaken = existingKeys.includes(s.key);

  const submit = () =>
    onSave({
      ...s,
      extensions: ext
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()),
      filenameRule: rule.trim() || null,
      moveAfterSendTo: move.trim() || null,
    });

  return (
    <div className="space-y-4">
      <Card title={isNew ? "소스 추가" : `소스 편집 — ${source.name}`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름" hint="사람이 보는 이름. 예: Zwick 인장기">
            <Input
              value={s.name}
              onChange={(e) => {
                const name = e.target.value;
                setS({ ...s, name, key: isNew && !s.key.length ? slugKey(name) : s.key });
              }}
            />
          </Field>
          <Field label="키" hint="서버와 원장이 이 키로 잇습니다. 소문자·숫자·-·_ 로 2~40자. 저장 뒤엔 바꾸지 마세요">
            <Input
              value={s.key}
              disabled={!isNew}
              onChange={(e) => setS({ ...s, key: e.target.value })}
              className={keyTaken ? "border-red-400" : ""}
            />
            {keyTaken && <div className="text-xs text-red-700">이미 있는 키입니다</div>}
          </Field>
          <Field label="폴더">
            <div className="flex gap-2">
              <Input value={s.path} onChange={(e) => setS({ ...s, path: e.target.value })} />
              <Button
                onClick={async () => {
                  const p = await window.matpylon.pickFolder();
                  if (p) setS({ ...s, path: p });
                }}
              >
                찾기
              </Button>
            </div>
          </Field>
          <Field label="확장자" hint="공백으로 구분. 비우면 전부. 예: .tra .csv">
            <Input value={ext} onChange={(e) => setExt(e.target.value)} />
          </Field>
          <Field label="안정화 시간(분)" hint="이 시간 동안 파일이 안 변해야 보냅니다. 장비가 천천히 쓰면 늘리세요">
            <Input
              type="number"
              min={0}
              max={1440}
              value={s.stableMinutes}
              onChange={(e) => setS({ ...s, stableMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="보낸 뒤 이동할 하위 폴더" hint="비우면 제자리에 둡니다(권장). 장비 SW 가 파일을 다시 열면 이동이 깨질 수 있습니다">
            <Input value={move} onChange={(e) => setMove(e.target.value)} placeholder="예: sent" />
          </Field>
        </div>
        <div className="mt-3 flex gap-6">
          <Toggle checked={s.recursive} onChange={(v) => setS({ ...s, recursive: v })} label="하위 폴더 포함" />
          <Toggle checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="활성" />
        </div>
      </Card>

      <Card title="파일명 규칙 (선택)">
        <Field
          label="정규식"
          hint={`이름 있는 그룹으로 힌트를 뽑습니다. 쓸 수 있는 이름: ${HINT_KEYS.join(", ")}. 안 맞는 파일도 힌트 없이 보냅니다.`}
        >
          <Input
            className="font-mono"
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            placeholder={String.raw`^(?<material_code>[^_]+)_(?<lot>[^_]+)_(?<specimen>[^.]+)\.tra$`}
          />
        </Field>
        {ruleCheck && !ruleCheck.ok && <p className="mt-1 text-xs text-red-700">정규식 오류: {ruleCheck.error}</p>}
        {ruleCheck?.ok && ruleCheck.unknownGroups.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            힌트가 아닌 그룹 이름: {ruleCheck.unknownGroups.join(", ")} — 서버가 무시합니다
          </p>
        )}
        {names.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-slate-600">미리보기 — 폴더의 파일 {names.length}개</div>
            <table className="w-full text-xs">
              <tbody>
                {preview.map(({ n, hints }) => (
                  <tr key={n} className="border-t border-slate-100">
                    <td className="py-1 font-mono">{n}</td>
                    <td className="text-slate-600">
                      {Object.keys(hints).length
                        ? Object.entries(hints)
                            .map(([k, v]) => `${k}=${v}`)
                            .join("  ")
                        : rule
                          ? "— 규칙에 안 맞음"
                          : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!s.name || !s.key || !s.path || keyTaken} onClick={submit}>
          저장
        </Button>
        <Button onClick={onCancel}>취소</Button>
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </div>
  );
}
