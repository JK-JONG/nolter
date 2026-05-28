// 사용자 10색 — 어트리뷰션 언어의 중심.
// 한 사람의 커서·획·스티키 테두리·접속자 점·캘린더 이벤트가 전부 이 색으로 묶인다.
// 각 색: base(점·획·테두리) / soft(배경 틴트) / label(이름표·진한, 흰 글씨) / ink(틴트 위 텍스트)

export type UserColorKey =
  | 'mint' | 'sky' | 'pink' | 'sun' | 'lav'
  | 'teal' | 'rose' | 'olive' | 'indigo' | 'forest'

export interface UserColor {
  key: UserColorKey
  name: string
  base: string
  soft: string
  label: string
  ink: string
}

export const USER_COLORS: UserColor[] = [
  { key: 'mint',   name: '민트',   base: '#2FCBA6', soft: '#DCF7EF', label: '#11A083', ink: '#0B7A62' },
  { key: 'sky',    name: '하늘',   base: '#5AAEFF', soft: '#E2EFFF', label: '#2E84E0', ink: '#1C61B4' },
  { key: 'pink',   name: '핑크',   base: '#FF8FC0', soft: '#FFE6F1', label: '#ED5795', ink: '#C2386F' },
  { key: 'sun',    name: '노랑',   base: '#FFC53D', soft: '#FFF2C9', label: '#D99700', ink: '#936700' },
  { key: 'lav',    name: '라벤더', base: '#A98BFF', soft: '#ECE4FF', label: '#7B55E6', ink: '#5938AE' },
  { key: 'teal',   name: '청록',   base: '#20B2C8', soft: '#D1F0F5', label: '#0A8DA3', ink: '#056370' },
  { key: 'rose',   name: '장미',   base: '#ED4D80', soft: '#FCDEE7', label: '#C9295F', ink: '#8B1840' },
  { key: 'olive',  name: '올리브', base: '#C2B143', soft: '#F0EBC8', label: '#94852A', ink: '#635816' },
  { key: 'indigo', name: '인디고', base: '#6573D4', soft: '#E0E4F8', label: '#4452B0', ink: '#2D3987' },
  { key: 'forest', name: '숲',     base: '#4B9F5A', soft: '#DCEFDF', label: '#2E7E3D', ink: '#1A5828' },
]

export const COLOR_KEYS = USER_COLORS.map(c => c.key)

export function colorByKey(k: UserColorKey | string): UserColor {
  return USER_COLORS.find(c => c.key === k) ?? USER_COLORS[0]
}
