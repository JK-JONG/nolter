<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSpace } from '@/stores/space'

const router = useRouter()
const space = useSpace()

// admin 가드: 로그인 안 됐거나 admin 아니면 차단.
if (!space.ready) router.replace({ name: 'gate' })
else if (!space.isAdmin) router.replace({ name: 'lobby' })

function back() { router.push({ name: 'lobby' }) }
</script>

<template>
  <div class="page bg-dots">
    <div class="wrap">
      <header class="top">
        <button class="back" @click="back" aria-label="로비로">←</button>
        <h1 class="title">설정</h1>
        <span class="admintag">ADMIN</span>
      </header>

      <section class="card">
        <h2 class="sec-title">모든 모임방</h2>
        <p class="sec-lead">사이트의 전체 방 목록을 보고 삭제할 수 있어요.</p>
        <div class="placeholder">
          <div class="ph-emoji">🗂️</div>
          <p>곧 여기에 전체 방 목록이 표시됩니다.<br><small>(서버 RPC 추가 작업 필요 — 다음 단계)</small></p>
        </div>
      </section>

      <section class="card">
        <h2 class="sec-title">모든 멤버</h2>
        <p class="sec-lead">동기화 코드로 등록된 사용자들이에요.</p>
        <div class="placeholder">
          <div class="ph-emoji">👥</div>
          <p>곧 여기에 전체 멤버 목록이 표시됩니다.<br><small>(서버 RPC 추가 작업 필요 — 다음 단계)</small></p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { min-height: 100dvh; padding: 32px 20px 80px; }
.wrap { max-width: 760px; margin: 0 auto; }

.top { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.back { width: 36px; height: 36px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-size: 17px; color: var(--ink-soft); display: grid; place-items: center; transition: all .15s var(--ease); }
.back:hover { background: var(--surface-2); color: var(--ink); }
.title { font-size: 24px; flex: 1; margin: 0; }
.admintag { font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 11px; letter-spacing: .12em; background: var(--ink); color: #fff; padding: 4px 10px; border-radius: var(--r-pill); }

.card { background: var(--surface); border-radius: var(--r-lg); padding: 24px; box-shadow: var(--sh-sm); border: 1px solid var(--line-soft); margin-bottom: 16px; }
.sec-title { font-size: 18px; margin: 0 0 6px; }
.sec-lead { font-size: 13.5px; color: var(--ink-soft); margin: 0 0 18px; }

.placeholder { text-align: center; padding: 28px 0; color: var(--ink-soft); background: var(--surface-2); border-radius: var(--r); border: 1px dashed var(--line); }
.ph-emoji { font-size: 36px; margin-bottom: 8px; }
.placeholder p { font-size: 13.5px; line-height: 1.6; margin: 0; }
.placeholder small { color: var(--ink-faint); font-size: 11.5px; }
</style>
