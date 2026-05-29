<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSpace } from '@/stores/space'
import { normalizeCode } from '@/lib/id'
import { USER_COLORS, colorByKey, type UserColorKey } from '@/lib/colors'

const router = useRouter()
const space = useSpace()

// 이미 공간+프로필이 준비됐고 이번 세션에서 인증까지 됐으면 게이트 건너뛰고 로비로.
// (ready 가 sessionAuthed 까지 포함하므로 자동으로 세션 검증됨)
if (space.ready) router.replace({ name: 'lobby' })

// 2단계 게이트 — 동기화 코드 = 사이트 입장권.
//  1) sync    — 코드를 모르면 진입 자체가 불가. 자체 발급 옵션 없음.
//  2) profile — 코드 통과 후에만 닉네임/색상.
const step = ref<'sync' | 'profile'>(space.hasSync ? 'profile' : 'sync')

// ── Step 1 (sync) ──
const syncInput = ref('')
const busy = ref(false)
const error = ref('')

const canEnter = computed(() => normalizeCode(syncInput.value).length >= 12)

async function submitSync() {
  if (!canEnter.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const ok = await space.enter(syncInput.value)
    if (!ok) { error.value = '동기화 코드가 올바르지 않아요 (12자 이상).'; return }
    // 서버에서 프로필이 복구됐다면 바로 로비로, 아니면 프로필 단계로.
    if (space.hasProfile) router.push({ name: 'lobby' })
    else step.value = 'profile'
  } finally { busy.value = false }
}

// ── Step 2 (profile) ──
const nickname = ref(space.nickname)
const password = ref(space.password)
const colorKey = ref<UserColorKey>(space.colorKey)
const profileValid = computed(() =>
  space.isValidNickname(nickname.value) && space.isValidPassword(password.value)
)

function submitProfile() {
  if (!profileValid.value) return
  space.setProfile(nickname.value, password.value, colorKey.value)
  router.push({ name: 'lobby' })
}

function backToSync() {
  step.value = 'sync'
}
</script>

<template>
  <div class="page bg-dots">
    <div class="shell">
      <!-- 왼쪽 환영 (공통) -->
      <div class="hero">
        <div class="logo"><span class="mark">✦</span> 놀터</div>
        <h1>친구들과<br>같이 그리는<br><em>놀이터.</em></h1>
        <p>동기화 코드 하나로 내 공간을 열어요. 로그인 없이, 어느 기기에서나 내 모임방이 그대로 이어집니다.</p>
        <div class="stickerrow">
          <span class="sticker" :style="{ background: colorByKey('mint').soft, color: colorByKey('mint').ink }">실시간 드로잉</span>
          <span class="sticker" :style="{ background: colorByKey('pink').soft, color: colorByKey('pink').ink }">스티키 메모</span>
          <span class="sticker" :style="{ background: colorByKey('sky').soft, color: colorByKey('sky').ink }">공유 캘린더</span>
        </div>
      </div>

      <!-- 오른쪽 — Step 1: 동기화 코드 -->
      <form v-if="step === 'sync'" class="panel" @submit.prevent="submitSync">
        <div class="steptag">1 / 2 · 동기화 코드</div>
        <h2 class="title">동기화 코드를 입력해주세요</h2>
        <p class="lead">초대받은 동기화 코드를 입력하면 내 공간이 열려요.</p>

        <div>
          <label class="label" for="sync">동기화 코드</label>
          <input id="sync" v-model="syncInput" class="field code-field" placeholder="ABCD-EFGH-JKLM" autocomplete="off" autofocus />
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="btn btn-primary enter" :disabled="!canEnter || busy">
          {{ busy ? '여는 중…' : '내 공간 열기' }} →
        </button>

        <p class="footnote">계정도, 비밀번호도 필요 없어요.<br>내 모임방은 동기화 코드를 아는 나만 볼 수 있어요.</p>
      </form>

      <!-- 오른쪽 — Step 2: 프로필 -->
      <form v-else class="panel" @submit.prevent="submitProfile">
        <div class="steprow">
          <button type="button" class="back" @click="backToSync" aria-label="동기화 코드 단계로 돌아가기">←</button>
          <div class="steptag">2 / 2 · 프로필</div>
        </div>
        <h2 class="title">나를 소개해주세요</h2>
        <p class="lead">친구들에게 보일 닉네임과 색을 골라요. 커서·획·스티키 전부 이 색으로 표시돼요.</p>

        <div>
          <label class="label" for="nick">닉네임</label>
          <input id="nick" v-model="nickname" class="field" placeholder="이름을 적어주세요" maxlength="16" autocomplete="off" autofocus />
        </div>

        <div>
          <label class="label" for="pw">비밀번호 <span class="hint">4자 이상</span></label>
          <input id="pw" v-model="password" type="password" class="field" placeholder="••••" maxlength="64" autocomplete="new-password" />
        </div>

        <div>
          <label class="label">내 색 고르기 <span class="hint">10가지 중 하나</span></label>
          <div class="colors">
            <button
              v-for="c in USER_COLORS" :key="c.key" type="button" class="colorbtn"
              :class="{ sel: colorKey === c.key }" :style="{ background: c.base }"
              :aria-label="c.name" :aria-pressed="colorKey === c.key" @click="colorKey = c.key"
            ></button>
          </div>
        </div>

        <button type="submit" class="btn btn-primary enter" :disabled="!profileValid">
          로비로 들어가기 →
        </button>
        <p class="footnote">언제든 로비에서 동기화 코드를 확인·복사할 수 있어요.</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.page { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.shell { width: 100%; max-width: 920px; display: grid; grid-template-columns: 1.05fr .95fr; background: var(--surface); border-radius: var(--r-xl); overflow: hidden; box-shadow: var(--sh-lg); border: 1px solid var(--line-soft); }

.hero { position: relative; padding: 44px 40px; overflow: hidden; background: radial-gradient(120% 120% at 0% 0%, var(--brand-soft) 0%, transparent 52%), var(--paper); }
.hero .logo { margin-bottom: 28px; }
.hero h1 { font-size: 34px; line-height: 1.12; color: var(--ink); margin-bottom: 14px; }
.hero h1 em { font-style: normal; color: var(--brand-ink); }
.hero p { font-size: 15.5px; color: var(--ink-soft); line-height: 1.6; max-width: 340px; }
.stickerrow { display: flex; gap: 10px; margin-top: 30px; flex-wrap: wrap; }
.sticker { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; padding: 8px 13px; border-radius: var(--r-pill); box-shadow: var(--sh-sm); }

.panel { padding: 38px 40px; display: flex; flex-direction: column; gap: 16px; }
.steprow { display: flex; align-items: center; gap: 10px; }
.steptag { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
.back { width: 32px; height: 32px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-size: 16px; color: var(--ink-soft); display: grid; place-items: center; transition: all .15s var(--ease); }
.back:hover { background: var(--surface-2); color: var(--ink); }
.title { font-size: 22px; line-height: 1.25; color: var(--ink); margin: 0; }
.lead { font-size: 14px; color: var(--ink-soft); line-height: 1.55; margin: 0 0 4px; }

.label { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; color: var(--ink-soft); margin-bottom: 9px; display: block; }
.label .hint { font-weight: 500; color: var(--ink-faint); font-size: 11.5px; }
.code-field { letter-spacing: .12em; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 17px; text-align: center; text-transform: uppercase; }

.colors { display: grid; grid-template-columns: repeat(5, 1fr); gap: 9px; }
.colorbtn { aspect-ratio: 1 / 1; width: 100%; border-radius: var(--r-pill); border: 3px solid #fff; cursor: pointer; position: relative; box-shadow: 0 0 0 1.5px var(--line), var(--sh-sm); transition: transform .15s var(--ease); }
.colorbtn:hover { transform: scale(1.08); }
.colorbtn.sel { box-shadow: 0 0 0 3px var(--ink), var(--sh); transform: scale(1.08); }
.colorbtn.sel::after { content: '✓'; position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 15px; }

.error { color: #C2386F; font-size: 13px; font-weight: 600; margin: 0; }
.enter { width: 100%; font-size: 16px; padding: 15px; }
.footnote { font-size: 12.5px; color: var(--ink-faint); text-align: center; line-height: 1.5; margin: 0; }

@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; max-width: 460px; }
  .hero { padding: 32px 28px; }
  .hero h1 { font-size: 28px; }
  .panel { padding: 28px; }
}
</style>
