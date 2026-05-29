import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ref, computed } from 'vue'
import { newSyncCode, normalizeCode, sha256Hex } from '@/lib/id'
import { colorByKey, type UserColorKey } from '@/lib/colors'
import { supabase } from '@/lib/supabase'

export interface RoomEntry { roomCode: string; title: string }

// 한 동기화 코드 = 한 사용자 공간(space row).
// space.data jsonb 에 profile(nickname/colorKey/passwordHash) + rooms 가 저장된다.
// 비밀번호는 sha256 hex 만 vault 에 push (평문은 같은 기기 localStorage 만).
//
// 관리자 식별 — 빌드 타임에 환경변수에서 주입. 둘 중 하나라도 비면 admin 비활성.
const ADMIN_NICKNAME = (import.meta.env.VITE_ADMIN_NICKNAME ?? '').trim()
const ADMIN_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD ?? '').trim()

// 세션 인증 — sessionStorage 라 탭/창 닫으면 사라진다. 새로 열면 비번 재입력 필수.
const SESSION_KEY = 'nolter.authedNickname'
function readSessionAuth(): string {
  try { return sessionStorage.getItem(SESSION_KEY) ?? '' } catch { return '' }
}

export const useSpace = defineStore('space', () => {
  const syncCode = useLocalStorage<string>('nolter.syncCode', '')
  const nickname = useLocalStorage<string>('nolter.nickname', '')
  // password = 평문(같은 기기 admin 비교용). passwordHash = vault 에 저장될 본인 인증 hash.
  const password     = useLocalStorage<string>('nolter.password', '')
  const passwordHash = useLocalStorage<string>('nolter.passwordHash', '')
  const colorKey = useLocalStorage<UserColorKey>('nolter.colorKey', 'mint')
  const rooms    = useLocalStorage<RoomEntry[]>('nolter.rooms', [])
  const version  = ref(0)  // 서버 버전(낙관적 잠금). 미동기/오프라인이면 0.

  // 세션 인증 마커 — 현재 탭에서 비번 검증을 통과한 닉네임. 새 탭/창에서는 빈값.
  const sessionAuthedFor = ref<string>(readSessionAuth())

  const color = computed(() => colorByKey(colorKey.value))
  const hasSync = computed(() => syncCode.value.length >= 12)
  // hash 가 있어야 등록된 사용자. 평문 password 는 admin 비교용으로만.
  const hasProfile = computed(() => nickname.value.trim().length > 0 && passwordHash.value.length > 0)
  const sessionAuthed = computed(() =>
    sessionAuthedFor.value.length > 0 && sessionAuthedFor.value === nickname.value.trim()
  )
  const ready = computed(() => hasSync.value && hasProfile.value && sessionAuthed.value)

  // 가입 모드 = vault 에 passwordHash 가 아직 없는 상태.
  const isCreatingAccount = computed(() => hasSync.value && !passwordHash.value)

  // 관리자 모드: 닉네임 + 비밀번호 모두 환경변수와 정확히 일치할 때만 true.
  const isAdmin = computed(() =>
    ADMIN_NICKNAME.length > 0 &&
    ADMIN_PASSWORD.length > 0 &&
    nickname.value.trim() === ADMIN_NICKNAME &&
    password.value === ADMIN_PASSWORD
  )

  function isValidNickname(n: string) { const t = n.trim(); return t.length >= 1 && t.length <= 16 }
  function isValidPassword(p: string) { return p.length >= 4 && p.length <= 64 }

  // ── 동기화 코드 ──
  function startNew() { syncCode.value = newSyncCode(); rooms.value = []; version.value = 0 }
  async function enter(code: string) {
    const c = normalizeCode(code)
    if (c.length < 12) return false
    syncCode.value = c
    await pull()
    return true
  }
  // 완전 초기화 — 동기화 코드(공간 ID)까지 버린다.
  function reset() {
    syncCode.value = ''; nickname.value = ''; password.value = ''; passwordHash.value = ''
    rooms.value = []; version.value = 0
    sessionStorage.removeItem(SESSION_KEY); sessionAuthedFor.value = ''
  }

  // 로그아웃 — 세션·평문 비번만 해제. syncCode/nickname/passwordHash 유지.
  function logout() {
    password.value = ''
    sessionStorage.removeItem(SESSION_KEY)
    sessionAuthedFor.value = ''
  }

  // ── 가입/로그인 (단일 진입점) ──
  // 가입 모드(hash 없음): pwConfirm 일치해야 hash 생성·저장.
  // 로그인 모드(hash 있음): 입력 비번의 hash 가 저장된 hash 와 일치해야 함.
  // 둘 다 성공 시: 평문 password / nickname / colorKey 저장 + 세션 인증 + push.
  async function login(
    n: string, p: string, c: UserColorKey, pConfirm?: string
  ): Promise<{ ok: boolean; mode: 'create' | 'login'; reason?: string }> {
    const mode: 'create' | 'login' = passwordHash.value ? 'login' : 'create'
    if (!isValidNickname(n)) return { ok: false, mode, reason: '닉네임이 올바르지 않아요.' }
    if (!isValidPassword(p)) return { ok: false, mode, reason: '비밀번호는 4자 이상이에요.' }
    const inputHash = await sha256Hex(p)
    if (mode === 'create') {
      if (pConfirm !== p) return { ok: false, mode, reason: '비밀번호가 일치하지 않아요.' }
      passwordHash.value = inputHash
    } else {
      if (passwordHash.value !== inputHash) return { ok: false, mode, reason: '비밀번호가 맞지 않아요.' }
    }
    nickname.value = n.trim(); password.value = p; colorKey.value = c
    sessionStorage.setItem(SESSION_KEY, nickname.value)
    sessionAuthedFor.value = nickname.value
    push()
    return { ok: true, mode }
  }

  // ── 방 목록 ──
  function hasRoom(roomCode: string) { return rooms.value.some(r => r.roomCode === roomCode) }
  function addRoom(entry: RoomEntry) {
    if (!hasRoom(entry.roomCode)) { rooms.value = [...rooms.value, entry]; push() }
  }
  function removeRoom(roomCode: string) {
    rooms.value = rooms.value.filter(r => r.roomCode !== roomCode); push()
  }
  function renameRoom(roomCode: string, title: string) {
    rooms.value = rooms.value.map(r => r.roomCode === roomCode ? { ...r, title } : r)
    push()
  }

  // ── 서버 동기화 ──
  function mergeRooms(serverRooms: RoomEntry[]) {
    const map = new Map<string, RoomEntry>()
    for (const r of serverRooms) map.set(r.roomCode, r)
    for (const r of rooms.value) if (!map.has(r.roomCode)) map.set(r.roomCode, r)
    rooms.value = [...map.values()]
  }
  async function pull() {
    if (!supabase || !hasSync.value) return
    try {
      const { data } = await supabase.rpc('space_pull', { p_code: syncCode.value })
      const row = Array.isArray(data) ? data[0] : data
      if (row?.data) {
        const d = row.data as {
          profile?: { nickname?: string; colorKey?: UserColorKey; passwordHash?: string }
          rooms?: RoomEntry[]
        }
        const hadLocalProfile = nickname.value.trim().length > 0
        if (d.profile?.nickname && !hadLocalProfile) nickname.value = d.profile.nickname
        if (d.profile?.colorKey && !hadLocalProfile) colorKey.value = d.profile.colorKey
        // vault 의 hash 가 정본 — 다른 기기에서 들어온 경우에도 검증할 수 있게 받음.
        if (d.profile?.passwordHash) passwordHash.value = d.profile.passwordHash
        if (Array.isArray(d.rooms)) mergeRooms(d.rooms)
        version.value = row.version ?? 0
      } else {
        version.value = 0
      }
    } catch { /* 오프라인/미설정 → 로컬만 */ }
  }
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  function push() {
    if (!supabase || !hasSync.value) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(doPush, 400)
  }
  async function doPush(retry = false) {
    if (!supabase || !hasSync.value) return
    const payload = {
      profile: {
        nickname: nickname.value,
        colorKey: colorKey.value,
        passwordHash: passwordHash.value,  // hash 만 push (평문 X)
      },
      rooms: rooms.value,
    }
    try {
      const { data } = await supabase.rpc('space_push', {
        p_code: syncCode.value, p_data: payload, p_expected_version: version.value,
      })
      const row = Array.isArray(data) ? data[0] : data
      if (row?.conflict && !retry) {
        const d = row.data as { rooms?: RoomEntry[] }
        if (Array.isArray(d?.rooms)) mergeRooms(d.rooms)
        version.value = row.version ?? version.value
        return doPush(true)
      }
      if (typeof row?.version === 'number') version.value = row.version
    } catch { /* 무시 */ }
  }

  return {
    syncCode, nickname, password, passwordHash, colorKey, rooms, color,
    hasSync, hasProfile, sessionAuthed, ready, isAdmin, isCreatingAccount,
    isValidNickname, isValidPassword,
    startNew, enter, reset, logout, login,
    hasRoom, addRoom, removeRoom, renameRoom, pull,
  }
})
