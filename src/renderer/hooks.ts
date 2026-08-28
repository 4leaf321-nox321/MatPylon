import { useCallback, useEffect, useState } from "react";
import type { Config } from "@engine/config";
import type { EngineStatus } from "@shared/ipc";

export function useStatus(): EngineStatus | null {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    void window.matpylon.getStatus().then(setStatus);
    return window.matpylon.onStatus(setStatus);
  }, []);
  return status;
}

/** 설정은 전체를 읽고 전체를 쓴다. `save` 는 서버가 거절한 이유를 돌려준다. */
export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const reload = useCallback(() => window.matpylon.getConfig().then((c) => setConfig(c as Config)), []);
  useEffect(() => void reload(), [reload]);
  const save = useCallback(
    async (next: Config): Promise<string | null> => {
      try {
        await window.matpylon.setConfig(next);
        setConfig(next);
        return null;
      } catch (e) {
        return (e as Error).message.replace(/^.*Error: /, "");
      }
    },
    [],
  );
  return { config, save, reload };
}
