// 橘猫三消 · 静态配置数据
// 命名统一 snake_case；零网络请求，所有资源本地内联。

var CAT_TYPES = [
  { key: 'orange', color: '#E87B2F', face: '#FFA366' }, // 橘猫（关卡目标）
  { key: 'brown', color: '#8B5A2B', face: '#B07C4A' },
  { key: 'green', color: '#7BC47F', face: '#A5D9A8' },
  { key: 'pink', color: '#F4889F', face: '#FFCAD6' },
  { key: 'yellow', color: '#FFC857', face: '#FFE1A0' }
];

var BOARD_COLS = 6;
var BOARD_ROWS = 8;

// 关卡配置：steps 步数、goal 需消除的橘猫数、base_score 单块基础分
var LEVELS = [
  { level: 1, steps: 15, goal: 10, target_text: '消除橘猫' },
  { level: 2, steps: 15, goal: 14, target_text: '消除橘猫' },
  { level: 3, steps: 15, goal: 18, target_text: '消除橘猫' },
  { level: 4, steps: 18, goal: 22, target_text: '消除橘猫' },
  { level: 5, steps: 18, goal: 26, target_text: '消除橘猫' }
];

// 通关目标分数（结算弹窗展示用）：每消除 1 个目标橘猫计 250 分
var SCORE_PER_TARGET = 250;

// 道具初始数量（对应设计稿：小锤 2 / 换位 5 / 薄荷 1）
var PROP_INITIAL = {
  hammer: 2,
  swap: 5,
  mint: 1
};
