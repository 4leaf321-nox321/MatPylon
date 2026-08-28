/** PAT 보관. 엔진은 "어디서 읽는지" 를 모른다 — Electron 이 safeStorage(DPAPI) 로
 * 구현해 넘긴다. 테스트는 메모리. 설정 JSON 에는 절대 넣지 않는다. */

export interface SecretStore {
  getToken(): string | null;
  setToken(token: string | null): void;
}

export function memorySecrets(initial: string | null = null): SecretStore {
  let token = initial;
  return { getToken: () => token, setToken: (t) => (token = t) };
}
