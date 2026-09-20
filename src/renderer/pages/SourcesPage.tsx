import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Config, Source } from "@engine/config";
import { HINT_GROUPS, HINT_KEYS, HINT_LABELS, type HintKey } from "@shared/hint-keys";
import { checkRule, extractHints, mergeHints } from "@engine/hints";
import type { ReferenceMaterial, ResolveItem } from "@shared/ipc";
import { useConfig } from "../hooks";
import { Badge, Button, Card, Field, Input, Select, Toggle } from "../ui";

const EMPTY: Source = {
  key: "",
  name: "",
  path: "",
  extensions: [],
  recursive: false,
  stableMinutes: 2,
  pathRule: null,
  moveAfterSendTo: null,
  defaults: {},
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
                {s.pathRule && " · 경로 규칙"}
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
  const [rule, setRule] = useState(source.pathRule ?? "");
  const ruleInput = useRef<HTMLInputElement>(null);
  const [move, setMove] = useState(source.moveAfterSendTo ?? "");
  const [names, setNames] = useState<string[]>([]);
  /** 소스 기본값 — 어느 힌트 키든. 재료·로트는 늘 보이고, 나머지는 값이 있거나 사람이 추가한 것만 칸을 그린다.
   * config.json 에 손으로 넣은 키도 여기 실려 와야 저장할 때 안 사라진다. */
  const [defaults, setDefaults] = useState<Partial<Record<HintKey, string>>>(() =>
    Object.fromEntries(HINT_KEYS.filter((k) => source.defaults[k]).map((k) => [k, source.defaults[k]!])),
  );
  const [extraDefaultKeys, setExtraDefaultKeys] = useState<HintKey[]>(() =>
    HINT_KEYS.filter((k) => k !== "material_code" && k !== "lot" && source.defaults[k]),
  );
  const setDefault = (k: HintKey, v: string) => setDefaults((d) => ({ ...d, [k]: v }));
  /** 빈 칸은 뺀다 — `null` 이 스물넷 늘어서는 것은 정보가 아니다. */
  const cleanDefaults = useMemo(
    () =>
      Object.fromEntries(
        HINT_KEYS.flatMap((k) => {
          const v = defaults[k]?.trim();
          return v ? [[k, v]] : [];
        }),
      ) as Partial<Record<HintKey, string>>,
    [defaults],
  );
  /** 서버 대조 결과. null = 서버 없음/미지원 → 열을 숨긴다. */
  const [resolved, setResolved] = useState<ResolveItem[] | null>(null);
  const [reference, setReference] = useState<ReferenceMaterial[] | null | "loading">(null);
  const [refQuery, setRefQuery] = useState("");

  const extensions = useMemo(
    () =>
      ext
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()),
    [ext],
  );
  // 미리보기는 스캔과 같은 눈으로 본다 — 하위 폴더·확장자·건너뛰는 폴더가 바뀌면 다시.
  useEffect(() => {
    if (!s.path) {
      setNames([]);
      return;
    }
    const t = setTimeout(() => {
      void window.matpylon
        .previewPaths({ path: s.path, recursive: s.recursive, extensions, moveAfterSendTo: move.trim() || null }, 20)
        .then(setNames);
    }, 300);
    return () => clearTimeout(t);
  }, [s.path, s.recursive, extensions, move]);

  /** 힌트 자리를 커서 위치(또는 고른 범위)에 끼워 넣는다 — 경로를 규칙 칸에 올린 뒤 바꿀 부분을 골라 누른다. */
  const insertToken = (token: string) => {
    const el = ruleInput.current;
    const start = el?.selectionStart ?? rule.length;
    const end = el?.selectionEnd ?? rule.length;
    setRule(rule.slice(0, start) + token + rule.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const ruleCheck = useMemo(() => (rule ? checkRule(rule) : null), [rule]);
  const preview = useMemo(
    () =>
      names.map((n) => {
        const fromPath = extractHints(rule || null, n);
        return {
          n,
          hit: Object.keys(fromPath).length > 0,
          hints: mergeHints(cleanDefaults, fromPath),
        };
      }),
    [names, rule, cleanDefaults],
  );
  const matched = preview.filter((p) => p.hit).length;

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
      extensions,
      pathRule: rule.trim() || null,
      moveAfterSendTo: move.trim() || null,
      defaults: cleanDefaults,
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
          <Field label="보낸 뒤 이동할 하위 폴더" hint="비우면 제자리에 둡니다(권장). 적으면 소스 폴더 아래 이 이름의 폴더로, 원래 폴더 구조 그대로 옮깁니다(sent\SUS304\LotA\…). 장비 SW 가 파일을 다시 열면 이동이 깨질 수 있습니다">
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
          경로 규칙은 시편만 뽑게 하세요. 「이 폴더는 전부 80 °C」「전부 의뢰 12」처럼 다른 힌트도 고정할 수
          있습니다. 경로 규칙이 뽑은 값이 있으면 그쪽이 이깁니다.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="재료 코드" hint="MatNexus 재료의 이름·grade·별칭 중 하나와 정확히 같아야 합니다">
            <Input
              value={defaults.material_code ?? ""}
              onChange={(e) => setDefault("material_code", e.target.value)}
              placeholder="예: SECC_MDOI_1.0"
            />
          </Field>
          <Field label="로트" hint="시료의 로트">
            <Input value={defaults.lot ?? ""} onChange={(e) => setDefault("lot", e.target.value)} placeholder="예: L240612" />
          </Field>
          {extraDefaultKeys.map((k) => (
            <Field key={k} label={HINT_LABELS[k]} hint={`{${k}}`}>
              <div className="flex gap-2">
                <Input value={defaults[k] ?? ""} onChange={(e) => setDefault(k, e.target.value)} />
                <Button
                  title="이 기본값을 뺍니다"
                  onClick={() => {
                    setExtraDefaultKeys((keys) => keys.filter((x) => x !== k));
                    setDefault(k, "");
                  }}
                >
                  빼기
                </Button>
              </div>
            </Field>
          ))}
        </div>
        <div className="mt-3">
          <Select
            value=""
            aria-label="다른 기본값 추가"
            onChange={(e) => {
              const k = e.target.value as HintKey;
              if (k) setExtraDefaultKeys((keys) => [...keys, k]);
            }}
          >
            <option value="">+ 다른 기본값…</option>
            {HINT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.keys
                  .filter((k) => k !== "material_code" && k !== "lot" && !extraDefaultKeys.includes(k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {HINT_LABELS[k]} ({k})
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </Card>

      <Card title="경로 규칙 (선택)">
        <p className="mb-2 text-xs text-slate-500">
          폴더 이름과 파일 이름에서 재료·로트·시편을 뽑습니다. 아래 미리보기의 경로 하나를 눌러 규칙 칸에 올리고,
          바뀌는 부분을 드래그한 뒤 힌트 단추를 누르세요. 나머지 글자는 그대로 맞춰야 합니다.
        </p>
        <Field
          label="규칙"
          hint={
            <>
              <code>{"{material_code}"}</code> 같은 자리 하나가 폴더 한 단계 또는 이름의 한 토막. <code>*</code> 는 아무
              글자, <code>**/</code> 는 폴더 여러 단계. <code>/</code> 가 없으면 파일 이름에만 댑니다(하위 폴더 어디든).
              대소문자는 안 가립니다. 안 맞는 파일도 힌트 없이 보냅니다. 정규식이 익숙하면{" "}
              <code>{"(?<lot>...)"}</code> 처럼 이름 있는 그룹으로 적어도 됩니다.
            </>
          }
        >
          <Input
            ref={ruleInput}
            className="font-mono"
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            placeholder="예: {material_code}/{lot}/*_{specimen}.tra"
          />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">끼워 넣기:</span>
          {HINT_GROUPS.map((group) => (
            <span key={group.label} className="inline-flex flex-wrap items-center gap-1">
              <span className="text-slate-400">{group.label}</span>
              {group.keys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-700 hover:border-blue-400"
                  onClick={() => insertToken(`{${k}}`)}
                  title={`{${k}}`}
                >
                  {HINT_LABELS[k]}
                </button>
              ))}
            </span>
          ))}
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-slate-700 hover:border-blue-400"
            onClick={() => insertToken("*")}
            title="아무 글자(폴더 한 단계 안)"
          >
            *
          </button>
          {ruleCheck?.ok && (
            <span className="ml-auto text-slate-400">
              {ruleCheck.kind === "regex" ? "정규식으로 해석" : "템플릿으로 해석"}
              {ruleCheck.keys.length > 0 && ` · 뽑는 힌트: ${ruleCheck.keys.join(", ")}`}
            </span>
          )}
        </div>
        {ruleCheck && !ruleCheck.ok && <p className="mt-1 text-xs text-red-700">규칙 오류: {ruleCheck.error}</p>}
        {ruleCheck?.ok && ruleCheck.unknownGroups.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            힌트가 아닌 자리 이름: {ruleCheck.unknownGroups.join(", ")} — 서버가 무시합니다. 쓸 수 있는 이름:{" "}
            {HINT_KEYS.join(", ")}
          </p>
        )}
        {ruleCheck?.ok && ruleCheck.keys.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            규칙에 힌트 자리가 없습니다 — 이대로면 아무것도 안 뽑습니다. 바뀌는 부분을 골라 위 단추를 누르세요.
          </p>
        )}
        {names.length === 0 && s.path && (
          <p className="mt-3 text-xs text-slate-400">
            이 폴더에 보낼 파일이 없습니다(확장자·하위 폴더 설정 기준). 규칙은 파일이 있을 때 미리보기로 맞추세요.
          </p>
        )}
        {names.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
              <span>
                미리보기 — 보낼 파일 {names.length}개{s.recursive && " (하위 폴더 포함, 폴더마다 골고루)"}
                {rule && matched < names.length && (
                  <span className="ml-2 font-normal text-amber-700">
                    규칙에 맞는 것 {matched} / {names.length}
                  </span>
                )}
              </span>
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
                  <th className="py-1 font-normal">경로 (누르면 규칙 칸에 올립니다)</th>
                  <th className="font-normal">힌트</th>
                  {resolved && <th className="font-normal">MatNexus 대조</th>}
                </tr>
              </thead>
              <tbody>
                {preview.map(({ n, hints, hit }, i) => (
                  <tr key={n} className="border-t border-slate-100 align-top">
                    <td className="py-1 font-mono">
                      <button
                        type="button"
                        className="text-left hover:text-blue-700 hover:underline"
                        title="이 경로를 규칙 칸에 올립니다"
                        onClick={() => {
                          setRule(n);
                          requestAnimationFrame(() => ruleInput.current?.focus());
                        }}
                      >
                        {n}
                      </button>
                    </td>
                    <td className="text-slate-600">
                      {Object.keys(hints).length
                        ? Object.entries(hints)
                            .map(([k, v]) => `${k}=${v}`)
                            .join("  ")
                        : rule
                          ? "— 규칙에 안 맞음"
                          : ""}
                      {rule && !hit && Object.keys(hints).length > 0 && (
                        <span className="ml-1 text-amber-700">(규칙에 안 맞음 — 기본값만)</span>
                      )}
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
