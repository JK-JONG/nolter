import type { UserColorKey } from './colors'

export type Tool = 'pen' | 'highlighter' | 'sticky' | 'eraser' | 'hand'
export type TabKey = 'canvas' | 'memo' | 'calendar' | 'list'

/** 그린 획 — append-only(한 번 그려지면 불변, 삭제만 가능). */
export interface Stroke {
  id: string
  authorId: string
  authorName: string
  colorKey: UserColorKey
  tool: 'pen' | 'highlighter'
  width: number
  points: number[] // 평탄화 좌표 [x0,y0,x1,y1,...] (캔버스 기준)
}

/** 스티키 노트 — 위치·텍스트 편집 가능(LWW). */
export interface Sticky {
  id: string
  authorId: string
  authorName: string
  colorKey: UserColorKey
  x: number
  y: number
  text: string
  updatedBy: string
  updatedByName: string
  updatedAt: number
}

/** 공유 캘린더 이벤트. endDate 가 있으면 [date..endDate] 다일 이벤트로 렌더. */
export interface EventEntity {
  id: string
  authorId: string
  authorName: string
  colorKey: UserColorKey
  title: string
  date: string         // YYYY-MM-DD (시작일)
  endDate?: string     // YYYY-MM-DD (종료일, 포함). 미지정/같으면 단일일 이벤트.
  time?: string        // HH:mm 선택
  updatedBy: string
  updatedByName: string
  updatedAt: number
}

/** 공유 리스트 항목(체크리스트). */
export interface ListItem {
  id: string
  authorId: string
  authorName: string
  colorKey: UserColorKey
  text: string
  done: boolean
  updatedBy: string
  updatedByName: string
  updatedAt: number
}

/** 실시간 접속자(Presence 에서 파생). */
export interface Peer {
  userId: string
  nickname: string
  colorKey: UserColorKey
  tool?: Tool
  isDrawing?: boolean
  tab?: TabKey
  editing?: 'memo' | null     // 지금 무엇을 편집 중인지(메모 라이브 라벨용)
  isHost?: boolean            // 관리자(=방장) 여부
}

export interface Cursor { x: number; y: number }

/** Broadcast 'op' 페이로드 — 모든 협업 변경이 이 형태로 오간다. */
export type Op =
  | { t: 'stroke:draw'; sender: string; stroke: Stroke }
  | { t: 'stroke:add';  sender: string; stroke: Stroke }
  | { t: 'sticky:upsert'; sender: string; sticky: Sticky }
  | { t: 'event:upsert';  sender: string; event: EventEntity }
  | { t: 'list:upsert';   sender: string; item: ListItem }
  | { t: 'note:set';    sender: string; text: string; updatedBy: string; updatedByName: string; updatedAt: number }
  | { t: 'config:set';  sender: string; lockAll: boolean; lockedUsers: string[] }
  | { t: 'delete'; sender: string; id: string }
  | { t: 'title'; sender: string; title: string }
