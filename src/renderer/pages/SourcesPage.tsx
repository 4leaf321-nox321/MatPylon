import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Config, Source } from "@engine/config";
import { HINT_KEYS } from "@shared/hint-keys";
import { checkRule, extractHints, mergeHints } from "@engine/hints";
import type { ReferenceMaterial, ResolveItem } from "@shared/ipc";
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
  defaults: { material_code: null, lot: null },
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
  footer,
}: {
  source: Source;
  isNew: boolean;
  existingKeys: string[];
  error: string | null;
  onSave: (s: Source) => void;
  onCancel: () => void;
  /** 마법사처럼 버튼을 바깥(풋터)에 두고 싶을 때. 주면 기본 버튼 줄을 그리지 않는다. */
  footer?: (ctx: { submit: () => void; canSubmit: boolean }) => ReactNode;
}) {
  const [s, setS] = useState<Source>(source);
  const [ext, setExt] = useState(source.extensions.join(" "));
  const [rule, setRule] = useState(source.filenameRule ?? "");
  const [move, setMove] = useState(source.moveAfterSendTo ?? "");
  const [names, setNames] = useState<string[]>([]);
  const [defMaterial, setDefMaterial] = useState(source.defaults.material_code ?? "");
  const [defLot, setDefLot] = useState(source.defaults.lot ?? "");
  /** 서버 대조 결과. null = 서버 없음/미지원 → 열을 숨긴다. */
  const [resolved, setResolved] = useState<ResolveItem[] | null>(null);
  const [reference, setReference] = useState<ReferenceMaterial[] | null | "loading">(null);
  const [refQuery, setRefQuery] = useState("");

  useEffect(() => {
    if (s.path) void window.matpylon.listFilenames(s.path, 20).then(setNames);
    else setNames([]);
  }, [s.path]);

  const ruleCheck = useMemo(() => (rule ? checkRule(rule) : null), [rule]);
  const preview = useMemo(
    () =>
      names.map((n) => ({
        n,
        hints: mergeHints(
          { material_code: defMaterial.trim() || null, lot: defLot.trim() || null },
          extractHints(rule || null, n),
        ),
      })),
    [names, rule, defMaterial, defLot],
  );

  // 규칙·기본값이 바뀌면 잠깐 뒤 서버에 물어본다. 타자마다 부르지 않는다.
  useEffect(() => {
    if (!preview.length) {
      setResolved(null);
      return;
    }
    const t = setTimeout(() => {
      void window.matpylon.resolveHints(preview.map((p) => p.hints as Record<string, string>)).then(setResolved);
    }, 400);
    return () => clearTimeout(t);
  }, [preview]);

  const loadReference = async () => {
    setReference("loading");
    setReference(await window.matpylon.reference());
  };
  const refFiltered = useMemo(() => {
    if (!reference || reference === "loading") return [];
    const q = refQuery.trim().toLowerCase();
    return q ? reference.filter((m) => m.aliases.some((a) => a.toLowerCase().includes(q))) : reference;
  }, [reference, refQuery]);
  const keyTaken = existingKeys.includes(s.key);
  const canSubmit = Boolean(s.name && s.key && s.path) && !keyTaken;

  const submit = () =>
    onSave({
      ...s,
      extensions: ext
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()),
      filenameRule: rule.trim() || null,
      moveAfterSendTo: move.trim() || null,
      defaults: { material_code: defMaterial.trim() || null, lot: defLot.trim() || null },
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

      <Card title="이 폴더의 기본값 (선택)">
        <p className="mb-2 text-xs text-slate-500">
          장비는 대개 파일명에 시편 번호만 적습니다. 이 폴더의 파일이 전부 한 재료·한 로트라면 여기 고정하고,
          파일명 규칙은 시편만 뽑게 하세요. 파일명 규칙이 뽑은 값이 있으면 그쪽이 이깁니다.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="재료 코드" hint="MatNexus 재료의 이름·grade·별칭 중 하나와 정확히 같아야 합니다">
            <Input value={defMaterial} onChange={(e) => setDefMaterial(e.target.value)} placeholder="예: SECC_MDOI_1.0" />
          </Field>
          <Field label="로트" hint="시료의 로트">
            <Input value={defLot} onChange={(e) => setDefLot(e.target.value)} placeholder="예: L240612" />
          </Field>
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
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
              <span>미리보기 — 폴더의 파일 {names.length}개</span>
              {resolved && (
                <span className="font-normal text-slate-500">
                  MatNexus 대조: 자동 등록 {resolved.filter((r) => r.outcome === "unique").length} / {resolved.length}
                  — 파일 안의 identity 가 있으면 그것이 힌트를 이깁니다
                </span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="py-1 font-normal">파일</th>
                  <th className="font-normal">힌트</th>
                  {resolved && <th className="font-normal">MatNexus 대조</th>}
                </tr>
              </thead>
              <tbody>
                {preview.map(({ n, hints }, i) => (
                  <tr key={n} className="border-t border-slate-100 align-top">
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
                    {resolved && (
                      <td>
                        {resolved[i] && (
                          <>
                            <Badge tone={resolved[i].outcome === "unique" ? "ok" : resolved[i].outcome === "multiple" ? "warn" : "bad"}>
                              {resolved[i].label}
                            </Badge>{" "}
                            <span className="text-slate-600">{resolved[i].detail}</span>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="MatNexus 참조 — 재료 › 시료(로트) › 시편"
        actions={
          reference === null ? (
            <Button onClick={loadReference}>불러오기</Button>
          ) : (
            <Input className="w-56" placeholder="재료 검색" value={refQuery} onChange={(e) => setRefQuery(e.target.value)} />
          )
        }
      >
        {reference === null && (
          <p className="text-xs text-slate-500">
            파일명이 어느 이름과 맞아야 붙는지 보면서 규칙을 잡습니다. 서버에 연결돼 있어야 합니다.
          </p>
        )}
        {reference === "loading" && <p className="text-xs text-slate-400">불러오는 중…</p>}
        {Array.isArray(reference) && reference.length === 0 && (
          <p className="text-xs text-slate-500">서버에서 받지 못했거나(연결·권한) 이 부서에 시료가 있는 재료가 없습니다.</p>
        )}
        {refFiltered.length > 0 && (
          <div className="max-h-72 overflow-auto text-xs">
            {refFiltered.slice(0, 50).map((m) => (
              <details key={m.name} className="border-t border-slate-100 py-1">
                <summary className="cursor-pointer">
                  <span className="font-medium">{m.name}</span>{" "}
                  <span className="text-slate-400">맞는 재료 코드: {m.aliases.join(" · ")}</span>
                </summary>
                <ul className="ml-4 mt-1 space-y-1">
                  {m.samples.map((s) => (
                    <li key={s.name}>
                      <span className="font-mono">{s.name}</span>{" "}
                      <span className="text-slate-500">로트 {s.lot || "(없음)"}</span>
                      <span className="ml-2 text-slate-500">시편: {s.specimens.map((p) => p.short).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {refFiltered.length > 50 && <p className="py-1 text-slate-400">… {refFiltered.length - 50}개 더. 검색으로 좁히세요</p>}
          </div>
        )}
      </Card>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {footer ? (
        footer({ submit, canSubmit })
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            저장
          </Button>
          <Button onClick={onCancel}>취소</Button>
        </div>
      )}
    </div>
  );
}
