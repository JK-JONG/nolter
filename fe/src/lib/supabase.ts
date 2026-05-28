import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 실시간 백엔드는 선택 사항이다. env 가 없으면 supabase=null → 앱은 "혼자(로컬 전용)" 모드.
// URL·키 모두 브라우저에 공개되는 public 값이라 번들 노출돼도 안전하다.
// 진짜 보안은 고엔트로피 "방 코드" + DB 의 SECURITY DEFINER RPC 가 담당한다.
const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigured = Boolean(url && key)

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, key as string, {
      // Supabase Auth 미사용(로그인 0) → 세션 저장/갱신 끔.
      auth: { persistSession: false, autoRefreshToken: false },
      // 커서/획 브로드캐스트를 위해 초당 이벤트 상한을 올린다(기본 10).
      realtime: { params: { eventsPerSecond: 40 } },
    })
  : null
