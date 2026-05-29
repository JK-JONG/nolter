// 신원·방코드·해시 유틸.
//
// 방 코드는 고엔트로피 랜덤 문자열이고, 이것이 유일한 접근 통제 수단이다(워크아웃과 동일).
//   - RPC 에는 평문 코드를 보낸다 → DB 가 sha256 하여 비교 (코드는 TLS 로만 전송).
//   - 실시간 채널 이름은 `room:<sha256(code)>` → 토픽에 평문 코드가 새지 않게.

// 헷갈리는 글자(O/0, I/1/L) 제외한 32자 알파벳.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 디바이스 영구 사용자 ID. 재접속해도 같은 사람으로 인식되어 어트리뷰션이 일관됨. */
export function newUserId(): string {
  return crypto.randomUUID()
}

// 내부: 지정한 자리수로 canonical 코드 생성. 256 % 32 === 0 → 모듈로 편향 없음.
function _generate(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += ALPHABET[b % 32]
  return s
}

/** 동기화 코드 — 12자(≈60bit). DB space 테이블 PK 해싱 대상. 안 바뀜. */
export function newSyncCode(): string { return _generate(12) }

/** 방 초대 코드 — 8자(≈40bit). 동기화 코드와 자리수를 다르게 해서 구분. */
export function newRoomCode(): string { return _generate(8) }

/** 입력 코드를 canonical(대문자·영숫자만)로 정규화. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** 사람이 읽기 쉽게 4자마다 대시(AB7K-9QXM-2F3H). */
export function formatCode(code: string): string {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, '$1-')
}

/** SubtleCrypto SHA-256 hex. 채널 이름용. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/** 엔티티 ID (획·스티키·메모·이벤트). */
export function newId(prefix = 'e'): string {
  return `${prefix}_${crypto.randomUUID()}`
}
