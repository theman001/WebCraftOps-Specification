// "명령어" 탭에서 마우스로 조립할 수 있는 서버 명령어 카탈로그.
// 실서버에 /help를 날려서 실제로 존재하는 명령어인지 확인한 목록 중, 운영자가 자주 쓰는
// 것만 추려서 카테고리(플레이어/서버)로 나눴다 — 전체 vanilla/Paper 명령어를 다 넣으면
// (수백 개) 오히려 찾기 어려워지므로 의도적으로 선별했다.
//
// arg.type:
//  - "player": 온라인 플레이어만 고르면 되는 경우 — <select>(드롭다운, 타이핑 불필요)
//  - "playerText": 오프라인 계정도 대상이 될 수 있는 경우(밴/화이트리스트 등) — 온라인
//    목록을 자동완성으로 보여주되 직접 입력도 가능한 <input list="...">
//  - "select": 정해진 값 중 하나 — <select>
//  - "number": 숫자 입력
//  - "text": 자유 텍스트(공지 문구 등 — 타이핑이 꼭 필요한 경우만 사용)

export const COMMAND_CATEGORIES = [
  { id: "player", label: "플레이어" },
  { id: "server", label: "서버" },
];

export const COMMANDS = [
  {
    id: "tp",
    category: "player",
    label: "텔레포트",
    syntax: "/tp <대상> <목적지>",
    args: [
      { type: "player", key: "target", label: "이동할 플레이어" },
      { type: "player", key: "destination", label: "도착 위치 (플레이어)" },
    ],
    build: (v) => `tp ${v.target} ${v.destination}`,
  },
  {
    id: "gamemode",
    category: "player",
    label: "게임모드 변경",
    syntax: "/gamemode <모드> <대상>",
    args: [
      {
        type: "select",
        key: "mode",
        label: "모드",
        options: [
          { label: "생존", value: "survival" },
          { label: "크리에이티브", value: "creative" },
          { label: "모험", value: "adventure" },
          { label: "관전", value: "spectator" },
        ],
      },
      { type: "player", key: "player", label: "대상 플레이어" },
    ],
    build: (v) => `gamemode ${v.mode} ${v.player}`,
  },
  {
    id: "effect-give",
    category: "player",
    label: "효과 부여",
    syntax: "/effect give <대상> <효과> <초> <강도>",
    args: [
      { type: "player", key: "player", label: "대상 플레이어" },
      {
        type: "select",
        key: "effect",
        label: "효과",
        options: [
          { label: "즉시 회복", value: "instant_health" },
          { label: "신속", value: "speed" },
          { label: "점프 강화", value: "jump_boost" },
          { label: "저항", value: "resistance" },
          { label: "화염 저항", value: "fire_resistance" },
          { label: "힘", value: "strength" },
          { label: "재생", value: "regeneration" },
          { label: "야간 투시", value: "night_vision" },
          { label: "수중 호흡", value: "water_breathing" },
          { label: "투명화", value: "invisibility" },
          { label: "포화", value: "saturation" },
          { label: "천천히 낙하", value: "slow_falling" },
          { label: "발광", value: "glowing" },
        ],
      },
      { type: "number", key: "seconds", label: "지속시간(초)", default: 60, min: 1, max: 1000000 },
      { type: "number", key: "amplifier", label: "강도(0=1단계)", default: 0, min: 0, max: 255 },
    ],
    build: (v) => `effect give ${v.player} minecraft:${v.effect} ${v.seconds} ${v.amplifier}`,
  },
  {
    id: "effect-clear",
    category: "player",
    label: "효과 전체 제거",
    syntax: "/effect clear <대상>",
    args: [{ type: "player", key: "player", label: "대상 플레이어" }],
    build: (v) => `effect clear ${v.player}`,
  },
  {
    id: "give",
    category: "player",
    label: "아이템 지급",
    syntax: "/give <대상> <아이템> <개수>",
    args: [
      { type: "player", key: "player", label: "대상 플레이어" },
      {
        type: "select",
        key: "item",
        label: "아이템",
        options: [
          { label: "다이아몬드", value: "diamond" },
          { label: "철 주괴", value: "iron_ingot" },
          { label: "금 주괴", value: "gold_ingot" },
          { label: "에메랄드", value: "emerald" },
          { label: "네더라이트 주괴", value: "netherite_ingot" },
          { label: "다이아몬드 검", value: "diamond_sword" },
          { label: "다이아몬드 곡괭이", value: "diamond_pickaxe" },
          { label: "엔더 진주", value: "ender_pearl" },
          { label: "불사의 토템", value: "totem_of_undying" },
          { label: "겉날개", value: "elytra" },
          { label: "빵", value: "bread" },
          { label: "구운 소고기", value: "cooked_beef" },
          { label: "황금 사과", value: "golden_apple" },
          { label: "경험치 병", value: "experience_bottle" },
          { label: "횃불", value: "torch" },
        ],
      },
      { type: "number", key: "count", label: "개수", default: 1, min: 1, max: 64 },
    ],
    build: (v) => `give ${v.player} minecraft:${v.item} ${v.count}`,
  },
  {
    id: "clear",
    category: "player",
    label: "인벤토리 비우기",
    syntax: "/clear <대상>",
    args: [{ type: "player", key: "player", label: "대상 플레이어" }],
    build: (v) => `clear ${v.player}`,
    danger: true,
  },
  {
    id: "kill",
    category: "player",
    label: "처치",
    syntax: "/kill <대상>",
    args: [{ type: "player", key: "player", label: "대상 플레이어" }],
    build: (v) => `kill ${v.player}`,
    danger: true,
  },
  {
    id: "kick",
    category: "player",
    label: "강제 퇴장",
    syntax: "/kick <대상> [사유]",
    args: [
      { type: "player", key: "player", label: "대상 플레이어" },
      { type: "text", key: "reason", label: "사유 (선택)", placeholder: "예: 규칙 위반", optional: true },
    ],
    build: (v) => `kick ${v.player}${v.reason ? ` ${v.reason}` : ""}`,
    danger: true,
  },
  {
    id: "op",
    category: "player",
    label: "관리자 권한 부여",
    syntax: "/op <대상>",
    args: [{ type: "playerText", key: "player", label: "대상 플레이어 (오프라인 계정도 가능)" }],
    build: (v) => `op ${v.player}`,
    danger: true,
  },
  {
    id: "deop",
    category: "player",
    label: "관리자 권한 해제",
    syntax: "/deop <대상>",
    args: [{ type: "playerText", key: "player", label: "대상 플레이어 (오프라인 계정도 가능)" }],
    build: (v) => `deop ${v.player}`,
    danger: true,
  },
  {
    id: "ban",
    category: "player",
    label: "차단 (밴)",
    syntax: "/ban <대상> [사유]",
    args: [
      { type: "playerText", key: "player", label: "대상 플레이어 (오프라인 계정도 가능)" },
      { type: "text", key: "reason", label: "사유 (선택)", placeholder: "예: 어뷰징", optional: true },
    ],
    build: (v) => `ban ${v.player}${v.reason ? ` ${v.reason}` : ""}`,
    danger: true,
  },
  {
    id: "pardon",
    category: "player",
    label: "차단 해제",
    syntax: "/pardon <대상>",
    args: [{ type: "playerText", key: "player", label: "대상 플레이어" }],
    build: (v) => `pardon ${v.player}`,
  },
  {
    id: "say",
    category: "server",
    label: "공지 (SAY)",
    syntax: "/say <메시지>",
    args: [{ type: "text", key: "message", label: "메시지", placeholder: "예: 5분 후 서버 재시작합니다" }],
    build: (v) => `say ${v.message}`,
  },
  {
    id: "time",
    category: "server",
    label: "시간 설정",
    syntax: "/time set <값>",
    args: [
      {
        type: "select",
        key: "value",
        label: "시간",
        options: [
          { label: "낮", value: "day" },
          { label: "정오", value: "noon" },
          { label: "밤", value: "night" },
          { label: "자정", value: "midnight" },
        ],
      },
    ],
    build: (v) => `time set ${v.value}`,
  },
  {
    id: "weather",
    category: "server",
    label: "날씨 설정",
    syntax: "/weather <값>",
    args: [
      {
        type: "select",
        key: "value",
        label: "날씨",
        options: [
          { label: "맑음", value: "clear" },
          { label: "비", value: "rain" },
          { label: "뇌우", value: "thunder" },
        ],
      },
    ],
    build: (v) => `weather ${v.value}`,
  },
  {
    id: "difficulty",
    category: "server",
    label: "난이도 설정",
    syntax: "/difficulty <값>",
    args: [
      {
        type: "select",
        key: "value",
        label: "난이도",
        options: [
          { label: "평화", value: "peaceful" },
          { label: "쉬움", value: "easy" },
          { label: "보통", value: "normal" },
          { label: "어려움", value: "hard" },
        ],
      },
    ],
    build: (v) => `difficulty ${v.value}`,
  },
  {
    id: "gamerule",
    category: "server",
    label: "게임 규칙 변경",
    syntax: "/gamerule <규칙> <값>",
    args: [
      {
        type: "select",
        key: "rule",
        label: "규칙",
        options: [
          { label: "죽어도 인벤토리 유지 (keepInventory)", value: "keepInventory" },
          { label: "낮/밤 순환 (doDaylightCycle)", value: "doDaylightCycle" },
          { label: "날씨 순환 (doWeatherCycle)", value: "doWeatherCycle" },
          { label: "몹 스폰 (doMobSpawning)", value: "doMobSpawning" },
          { label: "몹의 블록 파괴 (mobGriefing)", value: "mobGriefing" },
          { label: "불 번짐 (doFireTick)", value: "doFireTick" },
          { label: "자연 체력 회복 (naturalRegeneration)", value: "naturalRegeneration" },
          { label: "추락 데미지 (fallDamage)", value: "fallDamage" },
          { label: "업적 알림 (announceAdvancements)", value: "announceAdvancements" },
          { label: "사망 메시지 (showDeathMessages)", value: "showDeathMessages" },
        ],
      },
      {
        type: "select",
        key: "value",
        label: "값",
        options: [
          { label: "켜짐", value: "true" },
          { label: "꺼짐", value: "false" },
        ],
      },
    ],
    build: (v) => `gamerule ${v.rule} ${v.value}`,
  },
  {
    id: "whitelist-toggle",
    category: "server",
    label: "화이트리스트 켜기/끄기",
    syntax: "/whitelist <on|off>",
    args: [
      {
        type: "select",
        key: "value",
        label: "설정",
        options: [
          { label: "켜기", value: "on" },
          { label: "끄기", value: "off" },
        ],
      },
    ],
    build: (v) => `whitelist ${v.value}`,
  },
  {
    id: "whitelist-edit",
    category: "server",
    label: "화이트리스트 추가/제거",
    syntax: "/whitelist <add|remove> <대상>",
    args: [
      {
        type: "select",
        key: "action",
        label: "작업",
        options: [
          { label: "추가", value: "add" },
          { label: "제거", value: "remove" },
        ],
      },
      { type: "playerText", key: "player", label: "대상 플레이어 (오프라인 계정도 가능)" },
    ],
    build: (v) => `whitelist ${v.action} ${v.player}`,
  },
  {
    id: "list",
    category: "server",
    label: "접속자 목록 보기",
    syntax: "/list",
    args: [],
    build: () => "list",
  },
  {
    id: "save-all",
    category: "server",
    label: "전체 저장",
    syntax: "/save-all",
    args: [],
    build: () => "save-all",
  },
  {
    id: "restart",
    category: "server",
    label: "서버 재시작",
    syntax: "/restart",
    args: [],
    build: () => "restart",
    danger: true,
    confirmMessage: "서버를 재시작할까요? 접속 중인 플레이어 전원이 잠깐 끊깁니다.",
  },
  {
    id: "stop",
    category: "server",
    label: "서버 종료",
    syntax: "/stop",
    args: [],
    build: () => "stop",
    danger: true,
    confirmMessage: "서버를 종료할까요? 자동으로 다시 켜지는 설정이 아니면 직접 켜야 합니다.",
  },
];
