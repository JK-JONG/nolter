<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSpace } from '@/stores/space'
import { normalizeCode } from '@/lib/id'
import { USER_COLORS, colorByKey, type UserColorKey } from '@/lib/colors'

const router = useRouter()
const route = useRoute()
const space = useSpace()

function goAfterAuth() {
  const r = route.query.redirect
  const target = typeof r === 'string' && r.startsWith('/') ? r : null
  if (target) router.push(target)
  else router.push({ name: 'lobby' })
}
if (space.ready) goAfterAuth()

// 3단계:
//   1) sync   — 동기화 코드(게이트) 입력. 한번 통과하면 끝.
//   2) login  — 닉네임 + 비번. 아래 "회원가입" 링크로 3) 으로 이동.
//   3) signup — 닉네임 + 비번 + 확인 + 색. 완료되면 2) 로 돌아가 자동 로그인.
type Step = 'sync' | 'login' | 'signup'
const step = ref<Step>(space.hasSync ? 'login' : 'sync')

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
    step.value = 'login'
  } finally { busy.value = false }
}

// ── Step 2: login ──
const loginNick = ref(space.nickname)
const loginPw = ref('')
const loginValid = computed(() =>
  space.isValidNickname(loginNick.value) && space.isValidPassword(loginPw.value)
)
async function submitLogin() {
  if (!loginValid.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const res = await space.login(loginNick.value, loginPw.value)
    if (!res.ok) { error.value = res.reason ?? '로그인 실패'; return }
    loginPw.value = ''
    goAfterAuth()
  } finally { busy.value = false }
}
function goSignup() {
  step.value = 'signup'
  error.value = ''
  // 로그인 화면에서 입력 중이던 닉네임이 있으면 회원가입 폼으로 이어 가져감.
  signupNick.value = loginNick.value
  signupPw.value = ''
  signupPw2.value = ''
}

// ── Step 3: signup ──
const signupNick = ref('')
const signupPw = ref('')
const signupPw2 = ref('')
const signupColor = ref<UserColorKey>(space.colorKey || 'mint')
const signupValid = computed(() =>
  space.isValidNickname(signupNick.value) &&
  space.isValidPassword(signupPw.value) &&
  signupPw.value === signupPw2.value
)
async function submitSignup() {
  if (!signupValid.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const res = await space.signup(signupNick.value, signupPw.value, signupPw2.value, signupColor.value)
    if (!res.ok) { error.value = res.reason ?? '가입 실패'; return }
    // 가입 성공 → 자동 로그인 상태로 진입. (signup 이 sessionStorage 까지 세팅함)
    signupPw.value = ''
    signupPw2.value = ''
    goAfterAuth()
  } finally { busy.value = false }
}
function goLogin() {
  step.value = 'login'
  error.value = ''
  // 가입 도중 적은 닉네임이 있으면 로그인 화면에 채워주기.
  if (signupNick.value.trim()) loginNick.value = signupNick.value
}
</script>

<template>
  <div class="page bg-dots">
    <div class="shell">
      <!-- 왼쪽 환영 (공통) -->
      <div class="hero">
        <div class="logo"><span class="mark">✦</span> 놀터</div>
        <h1>친구들과<br>같이 그리는<br><em>놀이터.</em></h1>
        <p>동기화 코드 하나로 내 공간을 열어요. 같은 닉네임으로 다른 기기에 들어가도 내 모임방이 그대로 이어집니다.</p>
        <div class="stickerrow">
          <span class="sticker" :style="{ background: colorByKey('mint').soft, color: colorByKey('mint').ink }">실시간 드로잉</span>
          <span class="sticker" :style="{ background: colorByKey('pink').soft, color: colorByKey('pink').ink }">스티키 메모</span>
          <span class="sticker" :style="{ background: colorByKey('sky').soft, color: colorByKey('sky').ink }">공유 캘린더</span>
        </div>
      </div>

      <!-- Step 1: sync -->
      <form v-if="step === 'sync'" class="panel" @submit.prevent="submitSync">
        <div class="steptag">동기화 코드</div>
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
        <p class="footnote">동기화 코드는 한 번만 입력하면 됩니다.</p>
      </form>

      <!-- Step 2: login -->
      <form v-else-if="step === 'login'" class="panel" @submit.prevent="submitLogin">
        <div class="steptag">로그인</div>
        <h2 class="title">어서오세요</h2>
        <p class="lead">닉네임과 비밀번호를 입력해주세요.</p>
        <div>
          <label class="label" for="loginNick">닉네임</label>
          <input id="loginNick" v-model="loginNick" class="field" placeholder="닉네임" maxlength="16" autocomplete="username" autofocus />
        </div>
        <div>
          <label class="label" for="loginPw">비밀번호</label>
          <input id="loginPw" v-model="loginPw" type="password" class="field" placeholder="••••" maxlength="64" autocomplete="current-password" />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn btn-primary enter" :disabled="!loginValid || busy">
          {{ busy ? '확인 중…' : '로그인' }} →
        </button>
        <p class="signup-line">
          처음이신가요?
          <button type="button" class="link" @click="goSignup">회원가입</button>
        </p>
      </form>

      <!-- Step 3: signup -->
      <form v-else class="panel" @submit.prevent="submitSignup">
        <div class="steptag">회원가입</div>
        <h2 class="title">새 닉네임 만들기</h2>
        <p class="lead">이 게이트 안에서 친구들이 부를 닉네임이에요.</p>
        <div>
          <label class="label" for="suNick">닉네임 <span class="hint">1–16자</span></label>
          <input id="suNick" v-model="signupNick" class="field" placeholder="이름을 적어주세요" maxlength="16" autocomplete="off" autofocus />
        </div>
        <div>
          <label class="label" for="suPw">비밀번호 <span class="hint">4자 이상</span></label>
          <input id="suPw" v-model="signupPw" type="password" class="field" placeholder="••••" maxlength="64" autocomplete="new-password" />
        </div>
        <div>
          <label class="label" for="suPw2">비밀번호 확인</label>
          <input id="suPw2" v-model="signupPw2" type="password" class="field" placeholder="••••" maxlength="64" autocomplete="new-password" />
        </div>
        <div>
          <label class="label">내 색 고르기 <span class="hint">10가지 중 하나</span></label>
          <div class="colors">
            <button
              v-for="c in USER_COLORS" :key="c.key" type="button" class="colorbtn"
              :class="{ sel: signupColor === c.key }" :style="{ background: c.base }"
              :aria-label="c.name" :aria-pressed="signupColor === c.key" @click="signupColor = c.key"
            ></button>
          </div>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn btn-primary enter" :disabled="!signupValid || busy">
          {{ busy ? '가입 중…' : '가입하기' }} →
        </button>
        <p class="signup-line">
          이미 회원이신가요?
          <button type="button" class="link" @click="goLogin">로그인</button>
        </p>
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
.steptag { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
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

.signup-line { text-align: center; font-size: 13px; color: var(--ink-faint); margin: 4px 0 0; line-height: 1.4; }
.link {
  background: transparent; border: none; color: var(--brand-ink);
  font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px;
  cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
  padding: 0 4px;
}
.link:hover { color: var(--ink); }

@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; max-width: 460px; }
  .hero { padding: 32px 28px; }
  .hero h1 { font-size: 28px; }
  .panel { padding: 28px; }
}
</style>
