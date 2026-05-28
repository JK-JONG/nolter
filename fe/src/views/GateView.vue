<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSpace } from '@/stores/space'
import { normalizeCode } from '@/lib/id'
import { USER_COLORS, colorByKey, type UserColorKey } from '@/lib/colors'

const router = useRouter()
const space = useSpace()

// 이미 공간+프로필이 준비된 사용자는 게이트를 건너뛰고 바로 로비로.
if (space.ready) router.replace({ name: 'lobby' })

const mode = ref<'new' | 'enter'>(space.hasSync ? 'enter' : 'new')
const syncInput = ref(space.syncCode)
const nickname = ref(space.nickname)
const colorKey = ref<UserColorKey>(space.colorKey)
const busy = ref(false)
const error = ref('')

const color = computed(() => colorByKey(colorKey.value))
const valid = computed(() =>
  space.isValidNickname(nickname.value) &&
  (mode.value === 'new' || normalizeCode(syncInput.value).length >= 12)
)

async function go() {
  if (!valid.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    if (mode.value === 'new') space.startNew()
    else {
      const ok = await space.enter(syncInput.value)
      if (!ok) { error.value = '동기화 코드가 올바르지 않아요 (12자 이상).'; return }
    }
    space.setProfile(nickname.value, colorKey.value)
    router.push({ name: 'lobby' })
  } finally { busy.value = false }
}
</script>

<template>
  <div class="page bg-dots">
    <div class="shell">
      <!-- 왼쪽 환영 -->
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

      <!-- 오른쪽 폼 -->
      <form class="panel" @submit.prevent="go">
        <div class="seg" role="tablist">
          <button type="button" :class="{ on: mode === 'new' }" @click="mode = 'new'">새로 시작</button>
          <button type="button" :class="{ on: mode === 'enter' }" @click="mode = 'enter'">동기화 코드 입력</button>
        </div>

        <div v-if="mode === 'enter'">
          <label class="label" for="sync">동기화 코드 <span class="hint">다른 기기에서 쓰던 코드를 붙여넣으세요</span></label>
          <input id="sync" v-model="syncInput" class="field code-field" placeholder="ABCD-EFGH-JKLM" autocomplete="off" />
        </div>
        <p v-else class="newnote">새 개인 공간을 만들어요. 입장 후 로비에서 동기화 코드를 복사해두면 다른 기기에서도 이어갈 수 있어요.</p>

        <div>
          <label class="label" for="nick">닉네임</label>
          <input id="nick" v-model="nickname" class="field" placeholder="이름을 적어주세요" maxlength="16" autocomplete="off" />
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

        <button type="submit" class="btn btn-primary enter" :disabled="!valid || busy">
          {{ busy ? '여는 중…' : (mode === 'new' ? '내 공간 만들기' : '내 공간 열기') }} →
        </button>
        <p class="footnote">계정도, 비밀번호도 필요 없어요.<br>내 모임방은 동기화 코드를 아는 나만 볼 수 있어요.</p>
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

.panel { padding: 38px 40px; display: flex; flex-direction: column; gap: 18px; }
.seg { display: flex; gap: 6px; background: var(--surface-2); padding: 5px; border-radius: var(--r-pill); }
.seg button { flex: 1; border: none; background: transparent; cursor: pointer; padding: 10px; border-radius: var(--r-pill); font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 14px; color: var(--ink-soft); transition: all .18s var(--ease); }
.seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-sm); }

.label { font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 13px; color: var(--ink-soft); margin-bottom: 9px; display: block; }
.label .hint { font-weight: 500; color: var(--ink-faint); font-size: 11.5px; }
.code-field { letter-spacing: .12em; font-family: 'Nunito', sans-serif; font-weight: 800; font-size: 17px; text-align: center; text-transform: uppercase; }
.newnote { font-size: 13px; color: var(--ink-soft); background: var(--surface-2); padding: 12px 14px; border-radius: var(--r); margin: 0; line-height: 1.5; }

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
