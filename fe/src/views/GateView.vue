<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSpace } from '@/stores/space'
import { normalizeCode } from '@/lib/id'
import { USER_COLORS, colorByKey, type UserColorKey } from '@/lib/colors'

const router = useRouter()
const route = useRoute()
const space = useSpace()

// 인증 후 어디로 갈지 — 쿼리 redirect 우선.
function goAfterAuth() {
  const r = route.query.redirect
  const target = typeof r === 'string' && r.startsWith('/') ? r : null
  if (target) router.push(target)
  else router.push({ name: 'lobby' })
}
if (space.ready) goAfterAuth()

// 3단계 게이트:
//   1) sync     — 동기화 코드(게이트) 입력. 자체 발급 없음 — 초대 코드 obscurity.
//   2) nick     — 닉네임 입력. 서버에서 존재 여부 확인 → 가입 vs 로그인 자동 분기.
//   3a) login   — 비번 입력.
//   3b) signup  — 비번 + 확인 + 색상.
type Step = 'sync' | 'nick' | 'login' | 'signup'
const step = ref<Step>(space.hasSync ? 'nick' : 'sync')

const busy = ref(false)
const error = ref('')

// ── Step 1: sync ──
const syncInput = ref('')
const canEnter = computed(() => normalizeCode(syncInput.value).length >= 12)
async function submitSync() {
  if (!canEnter.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const ok = await space.enter(syncInput.value)
    if (!ok) { error.value = '동기화 코드가 올바르지 않아요 (12자 이상).'; return }
    step.value = 'nick'
  } finally { busy.value = false }
}

// ── Step 2: nickname (가입/로그인 자동 분기) ──
const nicknameInput = ref(space.nickname)
const nicknameValid = computed(() => space.isValidNickname(nicknameInput.value))
async function submitNickname() {
  if (!nicknameValid.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const r = await space.lookupMember(nicknameInput.value)
    if (r.exists) {
      // 같은 사람이 다른 기기에서 다시 들어오는 경우 — 비번만 받는다.
      step.value = 'login'
      // 서버가 알려준 색상이 있으면 미리 반영(가입 화면에서만 쓰지만 일관 UX).
      if (r.colorKey) colorKey.value = r.colorKey as UserColorKey
    } else {
      step.value = 'signup'
    }
    pwInput.value = ''
    pwConfirmInput.value = ''
  } finally { busy.value = false }
}

// ── Step 3a/3b: 비번 ──
const pwInput = ref('')
const pwConfirmInput = ref('')
const colorKey = ref<UserColorKey>(space.colorKey)
const pwValid = computed(() => space.isValidPassword(pwInput.value))
const signupValid = computed(() =>
  pwValid.value && pwInput.value === pwConfirmInput.value
)

async function submitLogin() {
  if (!pwValid.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const res = await space.login(nicknameInput.value, pwInput.value)
    if (!res.ok) { error.value = res.reason ?? '로그인 실패'; return }
    pwInput.value = ''; pwConfirmInput.value = ''
    goAfterAuth()
  } finally { busy.value = false }
}

async function submitSignup() {
  if (!signupValid.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const res = await space.signup(nicknameInput.value, pwInput.value, pwConfirmInput.value, colorKey.value)
    if (!res.ok) {
      error.value = res.reason ?? '가입 실패'
      // 중복 닉네임이면 닉네임 단계로 돌려보낸다.
      if (res.reason?.includes('이미 사용 중')) { step.value = 'nick' }
      return
    }
    pwInput.value = ''; pwConfirmInput.value = ''
    goAfterAuth()
  } finally { busy.value = false }
}

// ── 뒤로 가기 ──
function backTo(s: Step) { step.value = s; error.value = '' }
</script>

<template>
  <div class="page bg-dots">
    <div class="shell">
      <!-- 왼쪽 환영 (공통) -->
      <div class="hero">
        <div class="logo"><span class="mark">✦</span> 놀터</div>
        <h1>친구들과<br>같이 그리는<br><em>놀이터.</em></h1>
        <p>동기화 코드 하나로 내 공간을 열어요. 어느 기기에서나 같은 닉네임으로 들어오면 내 모임방이 그대로 이어집니다.</p>
        <div class="stickerrow">
          <span class="sticker" :style="{ background: colorByKey('mint').soft, color: colorByKey('mint').ink }">실시간 드로잉</span>
          <span class="sticker" :style="{ background: colorByKey('pink').soft, color: colorByKey('pink').ink }">스티키 메모</span>
          <span class="sticker" :style="{ background: colorByKey('sky').soft, color: colorByKey('sky').ink }">공유 캘린더</span>
        </div>
      </div>

      <!-- Step 1: sync -->
      <form v-if="step === 'sync'" class="panel" @submit.prevent="submitSync">
        <div class="steptag">1 / 3 · 동기화 코드</div>
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

      <!-- Step 2: nickname -->
      <form v-else-if="step === 'nick'" class="panel" @submit.prevent="submitNickname">
        <div class="steprow">
          <button type="button" class="back" @click="backTo('sync')" aria-label="동기화 코드로 돌아가기">←</button>
          <div class="steptag">2 / 3 · 닉네임</div>
        </div>
        <h2 class="title">닉네임을 알려주세요</h2>
        <p class="lead">이 게이트 안에서 친구들이 부를 이름이에요. 이미 같은 닉네임이 있으면 그 사람의 로그인이고, 처음이면 새로 가입합니다.</p>
        <div>
          <label class="label" for="nick">닉네임 <span class="hint">1–16자</span></label>
          <input id="nick" v-model="nicknameInput" class="field" placeholder="이름을 적어주세요" maxlength="16" autocomplete="off" autofocus />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn btn-primary enter" :disabled="!nicknameValid || busy">
          {{ busy ? '확인 중…' : '다음' }} →
        </button>
      </form>

      <!-- Step 3a: login -->
      <form v-else-if="step === 'login'" class="panel" @submit.prevent="submitLogin">
        <div class="steprow">
          <button type="button" class="back" @click="backTo('nick')" aria-label="닉네임으로 돌아가기">←</button>
          <div class="steptag">3 / 3 · 로그인</div>
        </div>
        <h2 class="title">{{ nicknameInput.trim() }}님, 어서오세요</h2>
        <p class="lead">비밀번호만 입력하면 됩니다.</p>
        <div>
          <label class="label" for="pw">비밀번호</label>
          <input id="pw" v-model="pwInput" type="password" class="field" placeholder="••••"
                 maxlength="64" autocomplete="current-password" autofocus />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn btn-primary enter" :disabled="!pwValid || busy">
          {{ busy ? '확인 중…' : '로그인' }} →
        </button>
      </form>

      <!-- Step 3b: signup -->
      <form v-else class="panel" @submit.prevent="submitSignup">
        <div class="steprow">
          <button type="button" class="back" @click="backTo('nick')" aria-label="닉네임으로 돌아가기">←</button>
          <div class="steptag">3 / 3 · 신규 가입</div>
        </div>
        <h2 class="title">"{{ nicknameInput.trim() }}" 으로 가입할게요</h2>
        <p class="lead">비밀번호와 내 색을 정해주세요.</p>
        <div>
          <label class="label" for="pw2">비밀번호 <span class="hint">4자 이상</span></label>
          <input id="pw2" v-model="pwInput" type="password" class="field" placeholder="••••"
                 maxlength="64" autocomplete="new-password" autofocus />
        </div>
        <div>
          <label class="label" for="pw3">비밀번호 확인</label>
          <input id="pw3" v-model="pwConfirmInput" type="password" class="field" placeholder="••••"
                 maxlength="64" autocomplete="new-password" />
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
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn btn-primary enter" :disabled="!signupValid || busy">
          {{ busy ? '가입 중…' : '가입 완료' }} →
        </button>
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
