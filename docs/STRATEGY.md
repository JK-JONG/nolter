# 놀터 (Nolter) — 전략 문서

> 친구끼리 방 코드 하나로 모여서 **같이 그리고(캔버스) · 메모하고 · 일정 잡는** 실시간 공유 공간. 레포/URL 슬러그는 `nolter`.
> 워크아웃 트래커(`93.SIDE/01.workout-tracker`)와 **같은 Supabase · 같은 GitHub Pages 배포**를 쓰되, 데이터 계층만 실시간 협업용으로 새로 설계한다.

---

## 1. 한 문장 요약

방 코드를 받은 친구들이 로그인 없이 들어와, **"지금 누가 무엇을 하는지가 캐치마인드처럼 또렷하게 보이는"** 실시간 보드에서 함께 그림을 그리고 메모를 남기고 캘린더로 일정을 맞춘다.

---

## 2. MVP 계약 (확정)

강조하신 **"메모 · 캔버스 · 누가 그리는지"** 를 1순위로, 공유 캘린더까지 MVP에 포함한다.

| Phase | 범위 | 핵심 가치 |
|---|---|---|
| **Phase 1 (MVP)** | 방 코드 + 신원(닉네임·색) 인프라 · 실시간 캔버스(자유 드로잉 + 스티키 노트) · 메모 · **공유 캘린더** · **Presence 어트리뷰션(캐치마인드 코어)** | 들어와서 같이 그리고·메모하고·일정 맞추고, **누가 뭘 하는지 실시간으로 보인다** |
| **Phase 2** | 할 일 체크리스트 → 모임 시간 잡기(when2meet) — 이 순서 | 일정 기능 심화 |
| **Phase 3** | vue-flow 보드 (별도 board type — 노드/엣지 다이어그램) | 구조화된 협업 다이어그램 |
| **Phase 4 (나중)** | CRDT(Yjs) 기반 진짜 동시 편집, 알림, 정식 로그인 옵션 | 충돌 없는 동시 타이핑 |

---

## 3. 사용자 시나리오 (30초)

1. 올라프가 놀터를 열고 "새 방 만들기" → `nolter.io/#/r/AB7K-9QXM-2F` 같은 코드 링크가 생긴다. 닉네임 `올라프`, 색 `민트` 선택.
2. 링크를 카톡으로 친구 둘에게 보낸다. 지수(`핑크`), 민호(`노랑`)가 클릭 → 닉네임·색 고르고 같은 방 입장.
3. 화면 우상단에 **접속자 3명**이 색 점 + 닉네임으로 뜬다. 캔버스 위에는 **각자 커서가 색·이름표를 달고** 움직인다.
4. 올라프가 펜으로 원을 그린다 → 지수·민호 화면에 **실시간으로 그려지고, 획 옆에 "올라프"** 가 따라붙는다 (캐치마인드 느낌).
5. 지수가 스티키 노트를 붙이고 타이핑 → 노트에 **"지수 편집 중"** 라벨이 뜬다. 민호는 캘린더 탭에서 토요일에 모임 일정을 추가한다.
6. 누가 새로고침하거나 나중에 다시 들어와도 캔버스·메모·캘린더가 그대로 남아 있다 (DB 영속).

---

## 4. 실시간 아키텍처

**워크아웃의 보안 모델(테이블 RLS 차단 + 고엔트로피 코드 + `SECURITY DEFINER` RPC)을 그대로 계승하되, "통째로 스냅샷 push/pull(vault)" 모델은 버린다.** 실시간 협업에서 스냅샷 낙관적 잠금은 동시 편집 시 한쪽을 통째로 덮어쓰기 때문이다.

### 4.1 신원 (로그인 0)
- `nolter.userId` — uuid, localStorage에 **영구 저장**. 재접속해도 같은 사람으로 인식 → 어트리뷰션이 일관됨.
- `nickname` + `color` — 입장 시 선택, 방별로 기억.

### 4.2 실시간 계층 — Supabase Realtime
- **채널**: 방 1개 = `room:<sha256(code)>` 채널 1개. (채널명이 코드 해시라 anon 키가 노출돼도 코드를 모르면 입장 불가 → obscurity 보안, 워크아웃과 동일 수준)
- **Presence**(누가 무엇 하는지의 단일 소스): `{ userId, nickname, color, cursor:{x,y}, tool, isDrawing }`. 접속자 목록 · 커서 라벨 · "편집 중" 표시 전부 여기서 파생.
- **Broadcast**(고빈도 임시 이벤트): 그리는 중 stroke 포인트(~50ms 배치), 커서 이동(~30Hz throttle), 스티키 드래그 위치. 모든 페이로드에 `{ senderId, nickname, color }` 동봉 → 받는 쪽이 즉시 누구 것인지 표시.

### 4.3 영속 계층 — DEFINER RPC (워크아웃 패턴 계승, 엔티티별로 분리)
- 테이블은 RLS ON + 정책 0개로 직접 접근 차단.
- `room_pull(code)` → 방의 모든 엔티티 반환 (strokes, sticky_notes, notes, events …)
- `room_upsert(code, entity_type, entity_json)` → 엔티티 1개 저장/갱신 (id 기준 upsert)
- `room_delete(code, entity_type, id)` → 삭제
- **엔티티별 행**으로 저장하므로 서로 다른 스티키/메모/이벤트를 동시에 편집해도 충돌 안 남. 드로잉 stroke는 **append-only**.

### 4.4 데이터 흐름 — Subscribe ↔ Pull 레이스 방지
순서가 핵심이다. **반드시 ① 채널 subscribe → ② RPC `room_pull` → ③ pull 결과를 베이스로 두고, 그 사이 도착한 broadcast/이벤트를 머지.** 순서를 반대로 하면 subscribe 전에 들어온 변경을 놓쳐 갭이 생긴다.

### 4.5 동시 편집 충돌 (MVP 정책)
- 같은 스티키/메모/이벤트를 두 명이 동시에 편집하는 경우 → **MVP는 CRDT를 쓰지 않는다.** 필드 단위 LWW(Last-Write-Wins) + **활성 편집자 라벨**("지수 편집 중")로 처리. 캐치마인드 톤과 자연스럽게 맞는다.
- 진짜 글자 단위 동시 편집(Yjs/CRDT)은 **Phase 4**로 미룬다.

---

## 5. 데이터 모델 + RPC 계약 (초안)

```
rooms        ( code_hash PK, title, created_at, updated_at )
strokes      ( id PK, room_hash, author_id, author_name, color, points jsonb, tool, created_at )   -- append-only
sticky_notes ( id PK, room_hash, author_id, x, y, w, h, text, color, updated_by, updated_at )
notes        ( id PK, room_hash, title, body, updated_by, updated_at )            -- 메모
events       ( id PK, room_hash, title, starts_at, ends_at, color, created_by, updated_by, updated_at )  -- 공유 캘린더
-- Phase 2 --
todos        ( id PK, room_hash, text, done, assignee, updated_by, updated_at )    -- 할 일
availability ( id PK, room_hash, user_id, slot, available )                       -- 모임 시간 잡기
-- Phase 3 --
flow_nodes / flow_edges                                                           -- vue-flow 보드
```

- 모든 테이블 RLS ON · 정책 0개. 접근은 RPC만.
- RPC는 전부 `SECURITY DEFINER` + `SET search_path = public, pg_temp` (워크아웃 `0001_vaults.sql` 패턴).
- 해시는 Postgres 내장 `sha256()` 사용 (pgcrypto 불필요, 워크아웃과 동일).

---

## 6. 디자인 톤 — 파스텔 플레이풀

- **분위기**: 부드러운 파스텔 + 둥근 모서리 + 작고 귀여운 마이크로 인터랙션. `expressive` 스킬을 순화해 "아기자기·현대식"으로. 제네릭 AI 미학(Inter 폰트 · 보라 그라데이션) 회피.
- **사람 = 색**: 어트리뷰션이 핵심이라 **사용자별 고정 색 팔레트**(민트/핑크/노랑/하늘/라벤더…)가 디자인 언어의 중심. 커서·획·노트 테두리·접속자 점·캘린더 이벤트가 전부 같은 색으로 묶인다.
- **캐치마인드 감성**: 커서에 꼬리표(이름), 그리는 동안 살짝 통통 튀는 모션, 접속/퇴장 시 부드러운 등장/사라짐.
- 구현 단계에서 `ui-ux-pro-max` → `frontend-design` → `make-interfaces-feel-better` 순으로 진행, `testing` 스킬로 반응형·접근성 검증.

---

## 7. 스택 · 배포 (워크아웃과 동일하게 유지)

- Vue 3 + `<script setup>` + TS · Vite · Pinia · VueUse · vue-router(hash) · PWA
- 실시간: `@supabase/supabase-js` Realtime (Presence + Broadcast)
- 캔버스 렌더: HTML Canvas 또는 SVG (Phase 1). **vue-flow는 Phase 3 별도 board type** — 자유 드로잉과 한 캔버스에 섞지 않는다 (렌더링 패러다임·좌표계가 다름).
- 배포: GitHub Pages 자동 (`.github/workflows/pages.yml`), `VITE_BASE=/<repo>/` 주입 — 워크아웃 워크플로우 복사.
- 폴더: `93.SIDE/02.nolter/fe/` (프론트), `supabase/migrations/` (DB).

---

## 8. 확정된 결정

1. **이름**: 놀터 (Nolter), 슬러그 `nolter`. ✅
2. **MVP 범위**: 캔버스(드로잉+스티키) + 메모 + 공유 캘린더 + 캐치마인드 어트리뷰션. ✅
3. **vue-flow 분리**: 자유 드로잉과 섞지 않고 Phase 3 별도 보드. ✅
4. **할 일 · 모임 시간 잡기**: Phase 2. ✅

### 구현 진행 (2026-05-28)
- ✅ `fe/` 스캐폴드 + 디자인 토큰 + 신원/색/supabase 라이브러리
- ✅ `supabase/migrations/0001_rooms.sql` — entities(generic) + DEFINER RPC(room_pull/upsert/delete/set_title)
- ✅ 실시간 계층 `useRoom` (subscribe→pull→merge, Presence, Broadcast, localStorage 폴백)
- ✅ 실시간 캔버스(드로잉+스티키+커서+어트리뷰션) 동작 검증
- ✅ 접근 모델 v2(아래): 0002 마이그레이션 + space 스토어 + GateView + LobbyView + 라우터 재배선 (typecheck·dev 검증)
- ✅ 프로젝트 `CLAUDE.md` 작성

### 2라운드 완료 (2026-05-28)
- ✅ 공유 캘린더 탭 — 첫 안: 날짜별 리스트 → **개편 v2**: 왼쪽 월 그리드 미리보기 + 오른쪽 일자 디테일·바로 추가. 셀 클릭으로 그 날 폼에 즉시 포커스.
- ✅ 메모 탭 (단일 공유 textarea + 디바운스 동기화 + presence 기반 "○○님이 편집 중" 라벨)
- ✅ **방장 입력 제어**: 전체 그리기 잠금 토글 + 접속자 개별 잠금/해제(아바타 클릭·lock 배지). 캔버스/메모/캘린더 모두 `canEdit` 게이트로 일관 차단 + 보기 전용 배너.

### 3라운드 — 코드 모델 단순화 (2026-05-28)
- ✅ **관리자/마스터 코드 개념 폐기.** 동기화 코드는 "내 공간 DB 동기화" 1가지 용도만. 방장은 **그 방을 만든 사람**(owner_id 매칭, honor-system).
- ✅ **초대 코드 = 방 코드** (1개). 별도 invite_code/회수 RPC 제거. 만든 사람이 코드 공유 → 친구가 코드 입력 → 친구 목록에 추가.
- ✅ DB 마이그레이션 **통합**(0001 단일). 추가: `room_create_simple`, `room_lookup`, rooms에 `owner_id`. 제거: admins, admin_register, is_admin, room_rotate_invite, list_admin_rooms, join_by_invite.
- ✅ **사용자 색 10가지로 확장** (mint/sky/pink/sun/lav + teal/rose/olive/indigo/forest).
- ✅ Gate: 관리자 필드 삭제, 10색 5×2 그리드. Lobby: **좌상단 "초대코드 입력" 코랄 강조 존**, 누구나 새 방 만들기, 방 카드에 방 코드 표시·복사. 방금 만든 방의 공유 안내 배너.

### 이번 스프린트 종료선 (2026-05-28)
**여기까지가 이번 스프린트.** 다 된 것: 접근 v2 + 실시간 캔버스 + 캘린더/메모 + 방장 제어. 새 아이디어는 아래 "다음 라운드"에만 적고 끼워넣지 않는다.

### 다음 라운드 (착수 전 합의 필요)
- 할 일 체크리스트 · 모임 시간 잡기(when2meet) — Phase 2.
- vue-flow 별도 보드(Phase 3).
- 스티키 "편집 중" 라이브 라벨(메모는 됨, 스티키 단위는 미구현) · 지우개 실제 동작 · 팬/줌 · 모바일 도구 독 위치.
- 관리자 방 삭제·이름 변경 RPC, 초대코드 만료/사용횟수 제한, 강퇴(kick).
- 무인증 한계 보강: 진짜 동시 편집을 위한 CRDT(Yjs) · 정식 로그인 옵션(Phase 4).

---

## 9. 접근 모델 v2 — 동기화 코드 + 로비 + 초대코드 (확정 2026-05-28)

기존 "코드 1개 = 바로 방 입장"을 **3단계**로 확장한다. 로그인은 여전히 없음(보안=코드 obscurity).

**3단계 흐름**
1. **동기화 코드 게이트** — 개인 공간 키. 입장한 방 목록 + 프로필(닉네임·색)을 이 코드 아래 저장하고 기기 간 동기화(워크아웃 vault식). 사람마다 다른 **개인용**이라 "내 목록에 없으면 안 보임"이 자연 성립.
2. **로비(모임방 목록)** — 내 공간의 방 카드 목록. `초대코드로 방 추가` 입력창. **관리자**면 `+ 새 모임방` + 방별 초대코드 관리 UI.
3. **방(캔버스)** — 기존 RoomView.

**확정 결정**
- **관리자 = 단일(마스터 코드)**. 마스터 코드 홀더만 방 생성·초대코드 발급. 손님은 초대코드 입력만. ✅
  - 부트스트랩: `admin_claim(code)` 는 `admins` 테이블이 비었을 때만 1회 성공(첫 클레임=유일 관리자). 클라 번들에 관리자 비밀을 넣지 않음.
- **초대코드 = 방별 별도, 발급·회수(재발급) 가능**. ✅ 회수는 *신규 가입* 차단(이미 코드를 받아 멤버가 된 사람은 유지) — 완전 차단은 방 코드 로테이션 필요(MVP 제외).

**DB 추가(0002)**
- `admins(code_hash pk)` · `space(code_hash pk, data jsonb)` (개인 목록+프로필 동기화)
- `rooms` 확장: 실시간 코드(room_code) + 현재 invite_code 보관(RLS 차단·DEFINER RPC로만 접근하므로 평문 보관 허용)
- RPC: `admin_claim` `is_admin` `room_create` `room_rotate_invite` `list_admin_rooms` `join_by_invite` `space_pull` `space_push`

**무인증 한계(명시)**: "관리자만"·"초대받은 사람만"은 코드 비밀성으로만 보장. 코드 재공유는 막지 못함. Postgres 침해 시 평문 코드 노출(친구용 obscurity 위협모델 내 허용).
