import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ref, computed } from 'vue'
import { newRoomCode, normalizeCode } from '@/lib/id'
import { colorByKey, type UserColorKey } from '@/lib/colors'
import { supabase } from '@/lib/supabase'

export interface RoomEntry { roomCode: string; title: string }

// 개인 공간 = 동기화 코드 1개. 방 목록 + 프로필(닉네임·색)을 이 코드 아래 저장하고
// 기기 간 동기화한다(워크아웃 vault 처럼 version 기반 낙관적 잠금).
// localStorage 는 "현재 공간"의 캐시이고, 서버(space_pull/push)가 기기 간 동기화를 담당.
// (관리자/마스터 코드 개념은 없음. 방장은 "그 방을 만든 사람" 으로 자연 귀속된다.)
// 관리자 식별 — 빌드 타임에 환경변수에서 주입. 둘 중 하나라도 비면 admin 비활성.
const ADMIN_NICKNAME = (import.meta.env.VITE_ADMIN_NICKNAME ?? '').trim()
const ADMIN_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD ?? '').trim()

export const useSpace = defineStore('space', () => {
  const syncCode = useLocalStorage<string>('nolter.syncCode', '')
  const nickname = useLocalStorage<string>('nolter.nickname', '')
  const password = useLocalStorage<string>('nolter.password', '')
  const colorKey = useLocalStorage<UserColorKey>('nolter.colorKey', 'mint')
  const rooms    = useLocalStorage<RoomEntry[]>('nolter.rooms', [])
  const version  = ref(0)  // 서버 버전(낙관적 잠금). 미동기/오프라인이면 0.

  const color = computed(() => colorByKey(colorKey.value))
  const hasSync = computed(() => syncCode.value.length >= 12)
  const hasProfile = computed(() => nickname.value.trim().length > 0 && password.value.length >= 4)
  const ready = computed(() => hasSync.value && hasProfile.value)

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
  function startNew() { syncCode.value = newRoomCode(); rooms.value = []; version.value = 0 }
  async function enter(code: string) {
    const c = normalizeCode(code)
    if (c.length < 12) return false
    syncCode.value = c
    await pull()
    return true
  }
  function reset() { syncCode.value = ''; nickname.value = ''; password.value = ''; rooms.value = []; version.value = 0 }

  // ── 프로필 ──
  function setProfile(n: string, p: string, c: UserColorKey) {
    if (!isValidNickname(n) || !isValidPassword(p)) return
    nickname.value = n.trim(); password.value = p; colorKey.value = c
    push()
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
        const d = row.data as { profile?: { nickname?: string; colorKey?: UserColorKey }; rooms?: RoomEntry[] }
        const hadLocalProfile = nickname.value.trim().length > 0
        if (d.profile?.nickname && !hadLocalProfile) nickname.value = d.profile.nickname
        if (d.profile?.colorKey && !hadLocalProfile) colorKey.value = d.profile.colorKey
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
    const payload = { profile: { nickname: nickname.value, colorKey: colorKey.value }, rooms: rooms.value }
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
    syncCode, nickname, password, colorKey, rooms, color,
    hasSync, hasProfile, ready, isAdmin, isValidNickname, isValidPassword,
    startNew, enter, reset, setProfile,
    hasRoom, addRoom, removeRoom, renameRoom, pull,
  }
})
