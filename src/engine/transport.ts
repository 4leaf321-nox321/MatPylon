/** 전송 인터페이스. P1 은 여기까지 — 구현은 P2(MatNexus API 클라이언트).
 *
 * 결과를 셋으로 가른다. 원장의 상태 기계가 그것만 안다. */

import type { Hints } from "./hints";

export interface Delivery {
  sourceKey: string;
  path: string;
  sha256: string;
  mtimeMs: number;
  hints: Hints;
}

export type DeliveryResult =
  | { kind: "sent"; serverId: string | null }
  /** 4xx — 다시 보내도 같다. 사람이 본다. */
  | { kind: "rejected"; error: string }
  /** 5xx·네트워크 — 백오프 후 다시. */
  | { kind: "retry"; error: string };

export interface Transport {
  configured(): boolean;
  deliver(item: Delivery): Promise<DeliveryResult>;
}

/** 서버가 없을 때. 보내지 않고 대기로 둔다. */
export const noTransport: Transport = {
  configured: () => false,
  deliver: async () => ({ kind: "retry", error: "서버가 설정되지 않았습니다" }),
};
