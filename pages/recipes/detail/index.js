// pages/recipes/detail/index.js - AI食谱分析详情页
const app = getApp();
const { request } = require('../../../utils/request');
const { toggleFavoriteRecipe, isRecipeFavorited, addDietRecord, formatDate, getCurrentStage } = require('../../../utils/storage');

// ─── 每日参考限量（用于计算进度条百分比）─────────────────────
const DAILY_LIMITS = {
  '1':  { potassium: 4000, phosphorus: 1000, sodium: 2300, protein_g: 70 },
  '2':  { potassium: 3500, phosphorus: 900,  sodium: 2000, protein_g: 56 },
  '3a': { potassium: 3000, phosphorus: 800,  sodium: 1800, protein_g: 56 },
  '3b': { potassium: 2500, phosphorus: 700,  sodium: 1500, protein_g: 42 },
  '4':  { potassium: 2000, phosphorus: 600,  sodium: 1500, protein_g: 42 },
  '5':  { potassium: 2000, phosphorus: 600,  sodium: 1200, protein_g: 42 },
};

// 营养素评级颜色
const EVAL_COLOR = { '低': '#52C41A', '适中': '#4A90D9', '偏高': '#FF4D4F' };
const SAFE_COLOR = { safe: '#52C41A', warning: '#FAAD14', danger: '#FF4D4F' };

// 餐段选项
const MEAL_OPTIONS = [
  { label: '早餐', value: '早餐', icon: '🌅' },
  { label: '午餐', value: '午餐', icon: '☀️' },
  { label: '下午茶', value: '下午茶', icon: '🍵' },
  { label: '晚餐', value: '晚餐', icon: '🌙' },
];

Page({
  data: {
    dishName: '',
    stageName: '',
    stage: '3a',
    loading: true,
    loadingStep: 0,
    result: null,
    error: null,
    isFavorited: false,
    // 展开/折叠控制
    ingredientsExpanded: true,
    stepsExpanded: true,
    nutritionExpanded: true,
    // 分析来源
    aiSource: '',
    aiSourceLabel: '',
    // 分量选择弹窗
    showPortionModal: false,
    portionGrams: 150,
    portionMin: 10,
    portionMax: 500,
    portionStep: 5,
    portionNutrients: [],
    mealOptions: MEAL_OPTIONS,
    selectedMealType: '午餐',
    // 配额限制
    _quotaExceeded: false,
  },

  onLoad(options) {
    const dishName = decodeURIComponent(options.dish || '');
    const fromCache = options.fromCache === '1';    // 来自收藏区点击
    const stage = options.stage || app.globalData.currentStage ||
                  getCurrentStage() || '3a';
    const stageConfig = app.globalData.stageConfig || {};
    const stageName = stageConfig[stage]?.name || `CKD ${stage}期`;

    wx.setNavigationBarTitle({ title: dishName ? `${dishName} - 分析` : 'AI食谱分析' });

    this.setData({
      dishName,
      stage,
      stageName,
      isFavorited: dishName ? isRecipeFavorited(dishName) : false,
    });

    if (dishName) {
      if (fromCache) {
        // 收藏入口：优先从数据库缓存读取，未命中则降级走 AI
        this.loadFromCacheOrAnalyze(dishName, stage);
      } else {
        // 主页搜索入口：每次都重新 AI 生成
        this.doAnalyze(dishName, stage);
      }
    }
  },

  onUnload() {
    if (this._stepTimer) clearInterval(this._stepTimer);
  },

  // ────── 模拟AI分析进度动画 ──────────────────────────────────
  _startLoadingAnim() {
    let step = 0;
    this._stepTimer = setInterval(() => {
      step = Math.min(step + 1, 4);
      this.setData({ loadingStep: step });
      if (step >= 4) clearInterval(this._stepTimer);
    }, 2000);
  },

  // ────── 收藏入口：先读缓存，命中则直接展示，未命中降级 AI ────
  async loadFromCacheOrAnalyze(dishName, stage) {
    if (!dishName) return;

    // ── 本地配额拦截：已超限则直接提示，不再发起请求 ──
    if (this.data._quotaExceeded) {
      wx.showToast({ title: '今日次数已用完，请开通会员', icon: 'none' });
      return;
    }

    // 显示加载态（缓存加载很快，用轻量版提示）
    this.setData({ loading: true, error: null, loadingStep: 2, result: null });

    try {
      const res = await request({
        url: `/recipes/cached/?dish_name=${encodeURIComponent(dishName)}&ckd_stage=${stage}`,
        method: 'GET',
      });

      if (res && res.hit && res.data) {
        // ── 缓存命中：直接渲染，跳过 AI ──────────────────
        const cached = res.data;
        const displayData = this._buildDisplayData(cached, stage);
        this.setData({
          loading: false,
          loadingStep: 4,
          result: displayData,
          aiSource: 'cache',
          aiSourceLabel: `📦 历史分析（${cached._cacheTime || '已缓存'}）`,
          isFavorited: isRecipeFavorited(dishName),
        });
        return;
      }
    } catch (err) {
      // 缓存接口失败不影响流程，静默降级
      console.warn('[Cache] 缓存读取失败，降级 AI 分析', err);
    }

    // ── 缓存未命中：走正常 AI 分析 ──────────────────────
    this.doAnalyze(dishName, stage);
  },

  // ────── 核心分析调用 ────────────────────────────────────────
  async doAnalyze(dishName, stage) {
    if (!dishName) return;
    if (this._stepTimer) clearInterval(this._stepTimer);

    this.setData({ loading: true, error: null, loadingStep: 0, result: null });
    this._startLoadingAnim();

    try {
      const res = await request({
        url: '/recipes/analyze/',
        method: 'POST',
        data: {
          dish_name: dishName,
          ckd_stage: stage || this.data.stage,
        },
      });

      if (this._stepTimer) clearInterval(this._stepTimer);
      this.setData({ loadingStep: 4 });

      // 构建前端展示数据
      const displayData = this._buildDisplayData(res, stage);

      setTimeout(() => {
        this.setData({
          loading: false,
          result: displayData,
          aiSource: res._source || 'deepseek_ai',
          aiSourceLabel: this._getSourceLabel(res._source),
          isFavorited: isRecipeFavorited(dishName),
        });
      }, 300);

    } catch (err) {
      if (this._stepTimer) clearInterval(this._stepTimer);
      console.error('AI分析失败:', err);

      // ── 429 配额限制（图片+文字分析共享 3次/天）──
      if (err.code === 429 && (err.data?._is_quota_limit || String(err.message || '').includes('次数已用完'))) {
        const qi = err.data?._quota_info || {};
        this.setData({
          loading: false,
          error: err.message || '今日分析次数已用完（3次/天），开通会员可无限使用',
          _quotaExceeded: true,
        });
        return;
      }

      // ── 其他错误 ──
      this.setData({
        loading: false,
        error: err.message || 'AI分析失败，请稍后重试',
      });
    }
  },

  // ────── 数据构建：将后端响应转为前端渲染数据 ────────────────
  _buildDisplayData(res, stage) {
    const limits = DAILY_LIMITS[stage] || DAILY_LIMITS['3a'];
    const nut = res.nutrition || {};
    const eval_ = res.nutritionEval || {};

    // ① 安全等级配置
    const safeLevelConfig = {
      safe:    { icon: '✅', label: '可以放心食用', gradient: 'linear-gradient(135deg, #52C41A 0%, #389E0D 100%)' },
      warning: { icon: '⚠️', label: '建议限量食用', gradient: 'linear-gradient(135deg, #FAAD14 0%, #D48806 100%)' },
      danger:  { icon: '🚫', label: '建议谨慎食用', gradient: 'linear-gradient(135deg, #FF4D4F 0%, #CF1322 100%)' },
    };
    const levelCfg = safeLevelConfig[res.safeLevel] || safeLevelConfig.warning;

    // ② 综合评分圆环（overallScore）
    const score = Math.max(0, Math.min(100, res.overallScore || 0));
    const scoreColor = score >= 75 ? '#52C41A' : score >= 40 ? '#FAAD14' : '#FF4D4F';

    // ③ 营养进度条列表（相对每日限量的占比）
    const nutritionBars = [
      {
        key: 'calories', label: '热量', unit: 'kcal',
        value: nut.calories || 0,
        dailyRef: 1800,
        percent: Math.min(100, Math.round(((nut.calories || 0) / 1800) * 100)),
        eval: eval_.calories || '适中',
        evalColor: EVAL_COLOR[eval_.calories] || '#4A90D9',
        barColor: EVAL_COLOR[eval_.calories] || '#4A90D9',
        icon: '🔥',
      },
      {
        key: 'protein', label: '蛋白质', unit: 'g',
        value: nut.protein || 0,
        dailyRef: limits.protein_g,
        percent: Math.min(100, Math.round(((nut.protein || 0) / limits.protein_g) * 100)),
        eval: eval_.protein || '适中',
        evalColor: EVAL_COLOR[eval_.protein] || '#4A90D9',
        barColor: EVAL_COLOR[eval_.protein] || '#4A90D9',
        icon: '💪',
      },
      {
        key: 'potassium', label: '钾', unit: 'mg',
        value: nut.potassium || 0,
        dailyRef: limits.potassium,
        percent: Math.min(100, Math.round(((nut.potassium || 0) / limits.potassium) * 100)),
        eval: eval_.potassium || '适中',
        evalColor: EVAL_COLOR[eval_.potassium] || '#FAAD14',
        barColor: EVAL_COLOR[eval_.potassium] || '#FAAD14',
        icon: '🫀',
      },
      {
        key: 'phosphorus', label: '磷', unit: 'mg',
        value: nut.phosphorus || 0,
        dailyRef: limits.phosphorus,
        percent: Math.min(100, Math.round(((nut.phosphorus || 0) / limits.phosphorus) * 100)),
        eval: eval_.phosphorus || '适中',
        evalColor: EVAL_COLOR[eval_.phosphorus] || '#FF7A45',
        barColor: EVAL_COLOR[eval_.phosphorus] || '#FF7A45',
        icon: '🦴',
      },
      {
        key: 'sodium', label: '钠', unit: 'mg',
        value: nut.sodium || 0,
        dailyRef: limits.sodium,
        percent: Math.min(100, Math.round(((nut.sodium || 0) / limits.sodium) * 100)),
        eval: eval_.sodium || '适中',
        evalColor: EVAL_COLOR[eval_.sodium] || '#722ED1',
        barColor: EVAL_COLOR[eval_.sodium] || '#722ED1',
        icon: '🧂',
      },
    ];

    // ④ 食材列表加工：添加颜色
    const ingredients = (res.ingredients || []).map(ing => ({
      ...ing,
      safeColor: SAFE_COLOR[ing.safe] || SAFE_COLOR.warning,
      categoryIcon: { '主料': '🥩', '辅料': '🥬', '调料': '🧄' }[ing.category] || '🍽️',
    }));

    // ⑤ 烹饪方式图标
    const cookMethodIcons = {
      '蒸': '♨️', '煮': '🫕', '炖': '🍲', '清炒': '🥘', '焯水': '💧',
      '炸': '🛢️', '烤': '🔥', '腌制': '🫙',
    };
    const cookMethod = res.cookMethod || { recommended: [], avoid: [] };
    const cookMethodDisplay = {
      recommended: (cookMethod.recommended || []).map(m => ({
        name: m, icon: cookMethodIcons[m] || '✅',
      })),
      avoid: (cookMethod.avoid || []).map(m => ({
        name: m, icon: cookMethodIcons[m] || '❌',
      })),
    };

    // ⑥ 替代食材评分颜色
    const alternatives = (res.alternatives || []).map(alt => ({
      ...alt,
      scoreColor: (alt.score || 0) >= 75 ? '#52C41A' : (alt.score || 0) >= 40 ? '#FAAD14' : '#FF4D4F',
      safeLevelIcon: alt.safeLevel === 'safe' ? '✅' : '⚠️',
    }));

    return {
      // 原始字段
      ...res,
      // 计算字段
      levelCfg,
      score,
      scoreColor,
      nutritionBars,
      ingredients,
      cookMethodDisplay,
      alternatives,
    };
  },

  _getSourceLabel(source) {
    const labels = {
      deepseek_ai: '🤖 DeepSeek AI 分析',
      local_fallback: '📋 本地规则分析（AI降级）',
      local_rules: '📋 本地规则分析',
      cache: '📦 历史分析结果',
    };
    return labels[source] || '🤖 AI 分析';
  },

  // ────── 展开/折叠交互 ────────────────────────────────────────
  toggleIngredients() {
    this.setData({ ingredientsExpanded: !this.data.ingredientsExpanded });
  },
  toggleSteps() {
    this.setData({ stepsExpanded: !this.data.stepsExpanded });
  },
  toggleNutrition() {
    this.setData({ nutritionExpanded: !this.data.nutritionExpanded });
  },

  // ────── 重新分析 ────────────────────────────────────────────
  retryAnalyze() {
    const { dishName, stage } = this.data;
    this.doAnalyze(dishName, stage);
  },

  // ────── 收藏 ───────────────────────────────────────────────
  async toggleFavorite() {
    const { result } = this.data;
    if (!result) return;
    try {
      const isFav = await toggleFavoriteRecipe({
        name: result.dishName,
        safeLevel: result.safeLevel,
        reason: result.reason,
        nutrition: result.nutrition,
        score: result.overallScore,
      });
      this.setData({ isFavorited: isFav });
      wx.showToast({ title: isFav ? '已收藏' : '已取消收藏', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  // ────── 记录饮食（打开分量选择弹窗）────────────────────
  addToRecord() {
    const { result } = this.data;
    if (!result) return;
    // 直接使用 servingGrams 作为默认克数
    const defaultGrams = result.servingGrams || 150;
    // 构建滑块范围：最小 10g，最大 max(500, 默认值×2)
    const maxGram = Math.max(500, defaultGrams * 2);
    // 根据当前时间推断默认餐段
    const now = new Date().getHours();
    let defaultMeal = '早餐';
    if (now >= 10 && now < 14) defaultMeal = '午餐';
    else if (now >= 14 && now < 18) defaultMeal = '下午茶';
    else if (now >= 18) defaultMeal = '晚餐';
    this.setData({
      showPortionModal: true,
      portionGrams: defaultGrams,
      portionMin: 10,
      portionMax: maxGram,
      portionStep: 5,
      selectedMealType: defaultMeal,
    });
    // 立即计算一次营养素
    this._updatePortionNutrients(defaultGrams);
  },

  // ── 选择餐段 ──
  selectMealType(e) {
    this.setData({ selectedMealType: e.currentTarget.dataset.value });
  },

  // ────── 根据摄入量计算各营养素（基准含量 × 克数/基准克数）───
  _updatePortionNutrients(grams) {
    const { result, stage } = this.data;
    if (!result || !result.nutrition) return;

    const nut = result.nutrition;
    // nutrition中的数值是整份的总量，用 servingGrams 作为基准
    const baseGrams = result.servingGrams || 200;
    const factor = grams / baseGrams;
    const limits = DAILY_LIMITS[stage] || DAILY_LIMITS['3a'];

    const items = [
      { key: 'calories', label: '热量', unit: 'kcal', value: (nut.calories || 0) * factor, dailyRef: 1800, icon: '🔥', color: '#4A90D9' },
      { key: 'protein', label: '蛋白质', unit: 'g', value: (nut.protein || 0) * factor, dailyRef: limits.protein_g, icon: '💪', color: '#52C41A' },
      { key: 'potassium', label: '钾', unit: 'mg', value: (nut.potassium || 0) * factor, dailyRef: limits.potassium, icon: '🫀', color: '#FAAD14' },
      { key: 'phosphorus', label: '磷', unit: 'mg', value: (nut.phosphorus || 0) * factor, dailyRef: limits.phosphorus, icon: '🦴', color: '#FF7A45' },
      { key: 'sodium', label: '钠', unit: 'mg', value: (nut.sodium || 0) * factor, dailyRef: limits.sodium, icon: '🧂', color: '#722ED1' },
    ].map(item => ({
      ...item,
      value: Math.round(item.value * 10) / 10,
      percent: Math.min(999, Math.round((item.value / item.dailyRef) * 100)),
    }));

    this.setData({ portionNutrients: items });
  },

  // ── 滑块拖动中（实时更新）──
  onPortionChanging(e) {
    const grams = e.detail.value;
    this.setData({ portionGrams: grams });
    this._updatePortionNutrients(grams);
  },

  // ── 滑块松手后确认值（同上，微信 slider 行为一致）──
  onPortionChange(e) {
    const grams = e.detail.value;
    this.setData({ portionGrams: grams });
    this._updatePortionNutrients(grams);
  },

  // ── 关闭分量弹窗 ──
  closePortionModal() {
    this.setData({ showPortionModal: false });
  },

  // ── 阻止事件冒泡（防止点击弹窗内容时关闭弹窗） ──
  stopPropagation() {},

  // ── 确认记录（用用户选择的克数计算后的营养数据写入）────
  async confirmRecord() {
    const { result, portionGrams, portionNutrients } = this.data;
    if (!result) return;

    // 用当前滑块对应的营养数据（已按比例换算）
    const calcNutrition = {};
    portionNutrients.forEach(n => {
      calcNutrition[n.key] = n.value;
    });

    const today = formatDate(new Date());
    try {
      await addDietRecord(today, {
        name: result.dishName,
        safeLevel: result.safeLevel,
        nutrition: calcNutrition,
        score: result.overallScore,
        mealType: this.data.selectedMealType,
        portionGrams,
      });
      app.calcTodayNutrition();

      this.setData({ showPortionModal: false });
      wx.showToast({ title: `已记录到${this.data.selectedMealType} ${portionGrams}g`, icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '记录失败，请重试', icon: 'none' });
    }
  },

  // ────── 查看替代菜品 ─────────────────────────────────────────
  viewAlternative(e) {
    const name = e.currentTarget.dataset.name;
    wx.navigateTo({
      url: `/pages/recipes/detail/index?dish=${encodeURIComponent(name)}&stage=${this.data.stage}`,
    });
  },

  // ────── 去开通 VIP ────────────────────────────────────────────
  goVip() {
    wx.navigateTo({ url: '/pages/vip/index/index' });
  },

  // ────── 分享 ────────────────────────────────────────────────
  onShareAppMessage() {
    const { result, dishName } = this.data;
    return {
      title: result ? `${result.dishName} - 肾友安全等级：${result.safeLevelLabel}` : `${dishName} - 肾友食光分析`,
      path: `/pages/recipes/detail/index?dish=${encodeURIComponent(dishName)}`,
    };
  },
});
