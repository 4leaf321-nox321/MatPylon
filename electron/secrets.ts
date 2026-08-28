/** PAT 를 DPAPI 로 감싸 파일에 둔다. 추가 설치 없음(결정 J). 설정 JSON 에는 안 넣는다. */
import { safeStorage } from "electron";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SecretStore } from "@engine/secrets";

export function fileSecrets(dataDir: string): SecretStore {
  const file = path.join(dataDir, "token.bin");
  return {
    getToken() {
      if (!existsSync(file)) return null;
      try {
        return safeStorage.decryptString(readFileSync(file));
      } catch {
        return null;
      }
    },
    setToken(token) {
      if (token === null) {
        if (existsSync(file)) unlinkSync(file);
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error("이 PC 에서 암호화 저장을 쓸 수 없습니다");
      writeFileSync(file, safeStorage.encryptString(token));
    },
  };
}
