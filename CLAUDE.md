# CLAUDE.md — 놀터 (Nolter)

## 프로젝트 개요
- **서비스**: 친구끼리 방 코드로 모여 **같이 그리고·메모하고·일정 잡는 실시간 보드** (프론트 단독 PWA)
- **핵심 가치**: 캐치마인드처럼 "지금 누가 그리는지" 또렷한 어트리뷰션 — **사람 = 색**
- **스택**: Vue 3 + `<script setup>` + TS · Vite · Pinia · VueUse · vue-router(hash) · PWA
- **백엔드**: Supabase (Realtime Presence/Broadcast + DEFINER RPC). **워크아웃 트래커와 같은 Supabase 프로젝트 공유 가능**(테이블이 다름).
- **호스팅**: GitHub Pages 자동 배포 (`.github/workflows/pages.yml`)
- 형제 프로젝트: `93.SIDE/01.workout-tracker` (같은 DB·배포 방식 계승)

## 실행 방법
```bash
cd fe
npm install
npm run dev          # http://localhost:5273
npm run typecheck    # vue-tsc
npm run build        # → fe/dist
```
- **솔로 모드**: `.env.local` 없이도 실행됨 (실시간 꺼짐, 이 기기 localStorage 에만 저장). UI에 "혼자 모드" 표시.

## Supabase 설정 (실시간 켜기)
1. Supabase 대시보드 → SQL Editor 에 `supabase/migrations/0001_rooms.sql` 실행 (단일 통합 마이그레이션).
2. `fe/.env.local` 작성 (`.env.example` 참고):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
3. **첫 가동 시 브라우저 콘솔 확인** — RPC(`room_create_simple`/`room_lookup`/`space_push` 등) 실제 호출은 Supabase 환경에서 첫 검증이므로 콘솔 경고(`[nolter] …`)를 확인할 것.

## 접근 모델
1. **동기화 코드 게이트** — 개인 공간 키 1개. 방 목록·프로필을 이 코드 아래 저장하고 기기 간 동기화(낙관적 잠금).
2. **로비** — 내가 추가한 방 목록만 보임. 좌상단 **"초대코드 입력"** 에 방 코드를 넣어 추가. 누구나 `새 모임방` 만들 수 있음.
3. **방(캔버스)** — 드로잉+스티키+메모+캘린더+실시간 커서+"○○님이 그리는 중" 어트리뷰션.

- **방 코드 = 초대 코드** (1개). 만든 사람이 친구에게 공유 → 친구가 코드 입력 → 친구 목록에 추가.
- **방장 = 방을 만든 사람**(owner_id). 별도 관리자/마스터 코드 없음. 호스트 권한(전체 잠금·개별 잠금)은 그 방을 만든 본인에게만.
- 보안 = **코드 obscurity**(로그인 없음). 호스트 강제는 honor-system(클라가 ownerId 매칭으로 판단).

## 배포 방법 (GitHub Pages)
- Repo Settings → Pages → Source = **GitHub Actions** (1회).
- Repo Settings → Secrets → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록(실시간 켜려면).
- `main` 푸시 → `pages.yml` 자동 빌드·배포. `VITE_BASE=/<repo>/` 자동 주입.

## 주의사항
- **라우터는 hash 모드** — GitHub Pages 404 회피. `createWebHistory()` 로 바꾸지 말 것.
- **워크아웃의 vault(통째 스냅샷) 모델을 쓰지 않는다.** 실시간은 Realtime Broadcast/Presence, 영속은 엔티티별 행 + DEFINER RPC. 스냅샷 push/pull 로 되돌리지 말 것.
- **데이터 흐름 순서**: 채널 subscribe → `room_pull` → 그 사이 도착 이벤트 union 병합 (레이스 방지). `useRoom.ts` 참고.
- **사람=색** 원칙 — 커서·획·스티키·접속자·캘린더 이벤트는 항상 그 사람 색. 디자인 토큰은 `fe/src/assets/main.css`, 시안은 `design/`.
- 아이콘은 SVG(이모지 금지) — 단 탭/빈상태 일부는 톤용 이모지 사용 중(차차 SVG 교체).

## Phase 로드맵
- **Phase 1 (현재)**: 접근 v2 + 실시간 캔버스(드로잉+스티키)+어트리뷰션. ✅ 메모/캘린더 탭은 빈 상태.
- **Phase 2**: 공유 캘린더 → 할 일 → 모임 시간 잡기(when2meet).
- **Phase 3**: vue-flow 별도 보드 (자유 드로잉과 안 섞음).
- **Phase 4**: CRDT(Yjs) 동시 편집·알림.
- 상세: `docs/STRATEGY.md`
