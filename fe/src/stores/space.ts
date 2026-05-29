import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ref, computed } from 'vue'
import { newSyncCode, normalizeCode, sha256Hex } from '@/lib/id'
import { colorByKey, type UserColorKey } from '@/lib/colors'
import { supabase } from '@/lib/supabase'

export interface RoomEntry { roomCode: string; title: string }

// 한 동기화 코드(게이트) 안에서 닉네임으로 멤버를 식별한다.
//   • 가입: 닉네임 중복 시 'duplicate' 에러.
//   • 로그인: 닉네임 + 비번 해시 일치 시 데이터 반환.
//   • 같은 닉네임 다른 디바이스 → 같은 행 → 룸 목록 로밍.
// 비밀번호 평문은 같은 기기 admin 비교용으로만 localStorage 에 둔다.
//
// 관리자 식별 — 빌드 타임 env 주입. 둘 중 하나라도 비면 admin 비활성.
// (주의: env 값이 클라이언트 번들에 노출되므로 친구용 honor-system 수준.)
const ADMIN_NICKNAME = (import.meta.env.VITE_ADMIN_NICKNAME ?? '').trim()
const ADMIN_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD ?? '').trim()

// 세션 인증 — sessionStorage 라 탭/창 닫으면 사라진다.
const SESSION_KEY = 'nolter.authedNickname'
function readSessionAuth(): string {
  try { return sessionStorage.getItem(SESSION_KEY) ?? '' } catch { return '' }
}

export const useSpace = defineStore('space', () => {
  const syncCode = useLocalStorage<string>('nolter.syncCode', '')
  const nickname = useLocalStorage<string>('nolter.nickname', '')
  const password     = useLocalStorage<string>('nolter.password', '')      // admin 비교용 평문(같은 기기)
  const passwordHash = useLocalStorage<string>('nolter.passwordHash', '')  // 정본은 서버
  const colorKey = useLocalStorage<UserColorKey>('nolter.colorKey', 'mint')
  const rooms    = useLocalStorage<RoomEntry[]>('nolter.rooms', [])
  const version  = ref(0)

  const sessionAuthedFor = ref<string>(readSessionAuth())

  const color = computed(() => colorByKey(colorKey.value))
  const hasSync = computed(() => syncCode.value.length >= 12)
  const hasProfile = computed(() => nickname.value.trim().length > 0 && passwordHash.value.length > 0)
  const sessionAuthed = computed(() =>
    sessionAuthedFor.value.length > 0 && sessionAuthedFor.value === nickname.value.trim()
  )
  const ready = computed(() => hasSync.value && hasProfile.value && sessionAuthed.value)

  const isAdmin = computed(() =>
    ADMIN_NICKNAME.length > 0 &&
    ADMIN_PASSWORD.length > 0 &&
    nickname.value.trim() === ADMIN_NICKNAME &&
    password.value === ADMIN_PASSWORD
  )

  function isValidNickname(n: string) { const t = n.trim(); return t.length >= 1 && t.length <= 16 }
  function isValidPassword(p: string) { return p.length >= 4 && p.length <= 64 }

  // ── 게이트 ──
  function startNew() { syncCode.value = newSyncCode(); rooms.value = []; version.value = 0 }
  async function enter(code: string) {
    const c = normalizeCode(code)
    if (c.length < 12) return false
    syncCode.value = c
    return true
  }

  // 완전 초기화 — 동기화 코드까지 버린다.
  function reset() {
    syncCode.value = ''
    nickname.value = ''; password.value = ''; passwordHash.value = ''
    rooms.value = []; version.value = 0; colorKey.value = 'mint'
    sessionStorage.removeItem(SESSION_KEY); sessionAuthedFor.value = ''
  }

  // 로그아웃 — 프로필 로컬 정리. 동기화 코드는 유지.
  function logout() {
    nickname.value = ''; password.value = ''; passwordHash.value = ''
    rooms.value = []; version.value = 0; colorKey.value = 'mint'
    sessionStorage.removeItem(SESSION_KEY); sessionAuthedFor.value = ''
  }

  // ── 닉네임 사전 조회 — 가입/로그인 분기 ──
  async function lookupMember(n: string): Promise<{ exists: boolean; colorKey?: UserColorKey }> {
    if (!supabase || !hasSync.value || !isValidNickname(n)) return { exists: false }
    try {
      const { data } = await supabase.rpc('space_lookup_member', {
        p_code: syncCode.value, p_nick: n.trim(),
      })
      return data ?? { exists: false }
    } catch { return { exists: false } }
  }

  // ── 신규 가입 ──
  async function signup(
    n: string, p: string, pConfirm: string, c: UserColorKey
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!isValidNickname(n)) return { ok: false, reason: '닉네임이 올바르지 않아요.' }
    if (!isValidPassword(p)) return { ok: false, reason: '비밀번호는 4자 이상이에요.' }
    if (pConfirm !== p) return { ok: false, reason: '비밀번호가 일치하지 않아요.' }
    const hash = await sha256Hex(p)
    if (supabase && hasSync.value) {
      try {
        const { data, error } = await supabase.rpc('space_signup', {
          p_code: syncCode.value, p_nick: n.trim(), p_hash: hash, p_color: c,
        })
        if (error) return { ok: false, reason: error.message ?? '서버 오류로 가입에 실패했어요.' }
        if (!data?.ok) {
          if (data?.reason === 'duplicate') return { ok: false, reason: '이미 사용 중인 닉네임이에요.' }
          return { ok: false, reason: '가입 실패: ' + (data?.reason ?? 'unknown') }
        }
        version.value = data.version ?? 1
      } catch (e) {
        return { ok: false, reason: '네트워크 오류 — 잠시 후 다시 시도해주세요.' }
      }
    } else {
      // 솔로 모드: 로컬만.
      version.value = 0
    }
    // 로컬 상태 갱신.
    nickname.value = n.trim(); password.value = p; passwordHash.value = hash; colorKey.value = c
    rooms.value = []
    sessionStorage.setItem(SESSION_KEY, nickname.value); sessionAuthedFor.value = nickname.value
    return { ok: true }
  }

  // ── 로그인 ──
  async function login(n: string, p: string): Promise<{ ok: boolean; reason?: string }> {
    if (!isValidNickname(n)) return { ok: false, reason: '닉네임을 확인해주세요.' }
    if (!isValidPassword(p)) return { ok: false, reason: '비밀번호를 확인해주세요.' }
    const hash = await sha256Hex(p)
    if (supabase && hasSync.value) {
      try {
        const { data, error } = await supabase.rpc('space_login', {
          p_code: syncCode.value, p_nick: n.trim(), p_hash: hash,
        })
        if (error) return { ok: false, reason: error.message ?? '서버 오류로 로그인에 실패했어요.' }
        if (!data?.ok) {
          if (data?.reason === 'no_member')   return { ok: false, reason: '등록되지 않은 닉네임이에요.' }
          if (data?.reason === 'bad_password') return { ok: false, reason: '비밀번호가 맞지 않아요.' }
          return { ok: false, reason: '로그인 실패: ' + (data?.reason ?? 'unknown') }
        }
        const d = data.data as {
          profile?: { nickname?: string; colorKey?: UserColorKey; passwordHash?: string }
          rooms?: RoomEntry[]
        }
        nickname.value = d.profile?.nickname ?? n.trim()
        colorKey.value = (d.profile?.colorKey as UserColorKey) ?? colorKey.value
        passwordHash.value = d.profile?.passwordHash ?? hash
        rooms.value = Array.isArray(d.rooms) ? d.rooms : []
        version.value = data.version ?? 1
      } catch (e) {
        return { ok: false, reason: '네트워크 오류 — 잠시 후 다시 시도해주세요.' }
      }
    } else {
      // 솔로: 로컬 hash 비교.
      if (passwordHash.value && passwordHash.value !== hash) {
        return { ok: false, reason: '비밀번호가 맞지 않아요.' }
      }
      nickname.value = n.trim(); passwordHash.value = hash
    }
    password.value = p  // admin 비교용
    sessionStorage.setItem(SESSION_KEY, nickname.value); sessionAuthedFor.value = nickname.value
    return { ok: true }
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
    if (!supabase || !hasSync.value || !nickname.value.trim()) return
    try {
      const { data } = await supabase.rpc('space_pull', {
        p_code: syncCode.value, p_nick: nickname.value.trim(),
      })
      const row = Array.isArray(data) ? data[0] : data
      if (row?.data) {
        const d = row.data as {
          profile?: { nickname?: string; colorKey?: UserColorKey; passwordHash?: string }
          rooms?: RoomEntry[]
        }
        if (d.profile?.colorKey) colorKey.value = d.profile.colorKey
        if (d.profile?.passwordHash) passwordHash.value = d.profile.passwordHash
        if (Array.isArray(d.rooms)) mergeRooms(d.rooms)
        version.value = row.version ?? 0
      }
    } catch { /* 오프라인 → 로컬만 */ }
  }
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  function push() {
    if (!supabase || !hasSync.value || !nickname.value.trim()) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(doPush, 400)
  }
  async function doPush(retry = false) {
    if (!supabase || !hasSync.value || !nickname.value.trim()) return
    const payload = {
      profile: {
        nickname: nickname.value,
        colorKey: colorKey.value,
        passwordHash: passwordHash.value,
      },
      rooms: rooms.value,
    }
    try {
      const { data } = await supabase.rpc('space_push', {
        p_code: syncCode.value,
        p_nick: nickname.value.trim(),
        p_data: payload,
        p_expected_version: version.value,
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
    hasSync, hasProfile, sessionAuthed, ready, isAdmin,
    isValidNickname, isValidPassword,
    startNew, enter, reset, logout,
    lookupMember, signup, login,
    hasRoom, addRoom, removeRoom, renameRoom, pull,
  }
})
