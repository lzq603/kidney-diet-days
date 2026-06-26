// pages/recipes/photo-analyze/index.js - 拍照识别分析页逻辑
const app = getApp();
const { request } = require('../../../utils/request');
const { toggleFavoriteRecipe, isRecipeFavorited, addDietRecord, formatDate, getCurrentStage } = require('../../../utils/storage');

// 每日参考限量
const DAILY_LIMITS = {
  '1':  { potassium: 4000, phosphorus: 1000, sodium: 2300, protein_g: 70 },
  '2':  { potassium: 3500, phosphorus: 900,  sodium: 2000, protein_g: 56 },
  '3a': { potassium: 3000, phosphorus: 800,  sodium: 1800, protein_g: 56 },
  '3b': { potassium: 2500, phosphorus: 700,  sodium: 1500, protein_g: 42 },
  '4':  { potassium: 2000, phosphorus: 600,  sodium: 1500, protein_g: 42 },
  '5':  { potassium: 2000, phosphorus: 600,  sodium: 1200, protein_g: 42 },
};

const EVAL_COLOR = { '低': '#52C41A', '适中': '#4A90D9', '偏高': '#FF4D4F' };
const SAFE_COLOR = { safe: '#52C41A', warning: '#FAAD14', danger: '#FF4D4F' };

// 餐段选项
const MEAL_OPTIONS = [
  { label: '早餐', value: '早餐', icon: '🌅' },
  { label: '午餐', value: '午餐', icon: '☀️' },
  { label: '下午茶', value: '下午茶', icon: '🍵' },
  { label: '晚餐', value: '晚餐', icon: '🌙' },
];

// 图片类型选项
const IMAGE_TYPES = [
  { key: 'cooked', icon: '🍽️', name: '成品菜', desc: '已经做好的菜' },
  { key: 'raw', icon: '🥬', name: '生食材', desc: '还没烹饪的原料' },
  { key: 'ingredient_list', icon: '📋', name: '配料表/菜单', desc: '菜牌或配料清单' },
  { key: 'nutrition_label', icon: '🏷️', name: '营养标签', desc: '包装上的营养成分表' },
];

// 类型中文映射（用于展示）
const TYPE_LABELS = {
  cooked: '成品菜',
  raw: '生食材',
  ingredient_list: '配料表/菜单',
  nutrition_label: '营养标签',
};

Page({
  data: {
    statusBarHeight: 44,
    // 图片相关
    photoSrc: '',
    imageBase64: '',
    dishName: '',        // AI 识别出的名称
    confidence: '',
    // 类型选择
    imageTypes: IMAGE_TYPES,
    selectedType: '',
    // 分析状态
    analyzing: false,
    loadingStep: 0,
    result: null,
    error: null,
    // 分期
    stage: '3a',
    stageName: '',
    _typeLabel: '',
    // 展开/折叠
    ingredientsExpanded: true,
    stepsExpanded: true,
    nutritionExpanded: true,
    // 收藏
    isFavorited: false,
    // 分量弹窗
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
    // 编辑识别结果
    showEditModal: false,
    editDishName: '',
  },

  onLoad(options) {
    const sysInfo = wx.getWindowInfo || wx.getSystemInfoSync;
    let info;
    try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { info = { statusBarHeight: 44 }; }
    
    // 接收从主页传过来的参数
    const imageBase64 = decodeURIComponent(options.imageBase64 || '');
    const dishName = decodeURIComponent(options.dishName || '');
    const confidence = decodeURIComponent(options.confidence || 'medium');
    
    const stage = app.globalData.currentStage || getCurrentStage() || '3a';
    const stageConfig = app.globalData.stageConfig || {};
    const stageName = stageConfig[stage]?.name || `CKD ${stage}期`;

    // 将 base64 转为临时图片路径用于显示
    if (imageBase64) {
      const fs = wx.getFileSystemManager();
      const tempPath = `${wx.env.USER_DATA_PATH}/photo_analyze_${Date.now()}.jpg`;
      try {
        fs.writeFileSync(tempPath, imageBase64, 'base64');
        this.setData({ photoSrc: tempPath });
      } catch (e) {
        console.warn('[photo-analyze] 写入临时图片失败，使用空占位', e);
      }
    }

    this.setData({
      statusBarHeight: info.statusBarHeight || 44,
      imageBase64,
      dishName,
      confidence,
      stage,
      stageName,
    });

    wx.setNavigationBarTitle({ title: dishName ? '图片分析' : '拍照分析' });
  },

  onUnload() {
    if (this._stepTimer) clearInterval(this._stepTimer);
    // 清理临时图片文件
    if (this.data.photoSrc && this.data.photoSrc.includes('photo_analyze_')) {
      try {
        wx.getFileSystemManager().unlinkSync(this.data.photoSrc);
      } catch (e) { /* 忽略 */ }
    }
  },

  goBack() {
    wx.navigateBack();
  },

  // ────── 编辑识别结果 ──────────────────────────
  editDishName() {
    this.setData({
      showEditModal: true, editDishName: this.data.dishName });
  },

  closeEditModal() {
    this.setData({ showEditModal: false, editDishName: '' });
  },

  onEditInput(e) {
    this.setData({ editDishName: e.detail.value });
  },

  confirmEdit() {
    const editDishName = this.data.editDishName.trim();
    if (!editDishName) {
      wx.showToast({ title: '请输入菜名', icon: 'none' });
      return;
    }
    this.setData({ dishName: editDishName, showEditModal: false, editDishName: '' });
  },

  // ────── 选择图片类型 ──────────────────────────
  selectType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ selectedType: type });
  },

  // ────── 开始分析 ──────────────────────────────
  startAnalyze() {
    const { selectedType, imageBase64, dishName, stage, _quotaExceeded } = this.data;
    if (!selectedType) {
      wx.showToast({ title: '请先选择图片类型', icon: 'none' });
      return;
    }

    // ── 本地配额拦截：已超限则直接提示，不再发起请求 ──
    if (_quotaExceeded) {
      wx.showToast({ title: '今日次数已用完，请开通会员', icon: 'none' });
      return;
    }

    this.setData({
      analyzing: true,
      error: null,
      loadingStep: 0,
      result: null,
      _typeLabel: TYPE_LABELS[selectedType] || selectedType,
    });

    this._startLoadingAnim();

    request({
      url: '/recipes/image-analyze/',
      method: 'POST',
      data: {
        image: imageBase64,
        image_type: selectedType,
        ckd_stage: stage,
        dish_hint: dishName,
      },
    })
      .then(res => {
        if (this._stepTimer) clearInterval(this._stepTimer);
        this.setData({ loadingStep: 4 });

        const displayData = this._buildDisplayData(res, stage);

        setTimeout(() => {
          this.setData({
            analyzing: false,
            result: displayData,
            isFavorited: dishName ? isRecipeFavorited(res.dishName || dishName) : false,
          });
        }, 400);
      })
      .catch(err => {
        if (this._stepTimer) clearInterval(this._stepTimer);
        console.error('[ImageAnalyze] 分析失败:', err);

        // ── 429 配额限制（图片+文字分析共享 3次/天）──
        if (err.code === 429 && (err.data?._is_quota_limit || String(err.message || '').includes('次数已用完'))) {
          const qi = err.data?._quota_info || {};
          this.setData({
            analyzing: false,
            error: err.message || '今日分析次数已用完（3次/天），开通会员可无限使用',
            _quotaExceeded: true,
          });
          return;
        }

        // ── 其他错误 ──
        this.setData({
          analyzing: false,
          error: err.message || '分析失败，请重试',
        });
      });
  },

  // ────── 加载动画 ──────────────────────────────
  _startLoadingAnim() {
    let step = 0;
    this._stepTimer = setInterval(() => {
      step = Math.min(step + 1, 4);
      this.setData({ loadingStep: step });
      if (step >= 4) clearInterval(this._stepTimer);
    }, 2000);
  },

  // ────── 数据构建（与 detail 页一致）────────────
  _buildDisplayData(res, stage) {
    const limits = DAILY_LIMITS[stage] || DAILY_LIMITS['3a'];
    const nut = res.nutrition || {};
    const eval_ = res.nutritionEval || {};

    // 安全等级配置
    const safeLevelConfig = {
      safe:    { icon: '✅', label: '可以放心食用', gradient: 'linear-gradient(135deg, #52C41A 0%, #389E0D 100%)' },
      warning: { icon: '⚠️', label: '建议限量食用', gradient: 'linear-gradient(135deg, #FAAD14 0%, #D48806 100%)' },
      danger:  { icon: '🚫', label: '建议谨慎食用', gradient: 'linear-gradient(135deg, #FF4D4F 0%, #CF1322 100%)' },
    };
    const levelCfg = safeLevelConfig[res.safeLevel] || safeLevelConfig.warning;

    // 综合评分
    const score = Math.max(0, Math.min(100, res.overallScore || 0));
    const scoreColor = score >= 75 ? '#52C41A' : score >= 40 ? '#FAAD14' : '#FF4D4F';

    // 营养进度条
    const nutritionBars = [
      { key: 'calories', label: '热量', unit: 'kcal', value: nut.calories || 0, dailyRef: 1800, percent: Math.min(100, Math.round(((nut.calories || 0) / 1800) * 100)), eval: eval_.calories || '适中', evalColor: EVAL_COLOR[eval_.calories] || '#4A90D9', barColor: EVAL_COLOR[eval_.calories] || '#4A90D9', icon: '🔥' },
      { key: 'protein', label: '蛋白质', unit: 'g', value: nut.protein || 0, dailyRef: limits.protein_g, percent: Math.min(100, Math.round(((nut.protein || 0) / limits.protein_g) * 100)), eval: eval_.protein || '适中', evalColor: EVAL_COLOR[eval_.protein] || '#4A90D9', barColor: EVAL_COLOR[eval_.protein] || '#4A90D9', icon: '💪' },
      { key: 'potassium', label: '钾', unit: 'mg', value: nut.potassium || 0, dailyRef: limits.potassium, percent: Math.min(100, Math.round(((nut.potassium || 0) / limits.potassium) * 100)), eval: eval_.potassium || '适中', evalColor: EVAL_COLOR[eval_.potassium] || '#FAAD14', barColor: EVAL_COLOR[eval_.potassium] || '#FAAD14', icon: '🫀' },
      { key: 'phosphorus', label: '磷', unit: 'mg', value: nut.phosphorus || 0, dailyRef: limits.phosphorus, percent: Math.min(100, Math.round(((nut.phosphorus || 0) / limits.phosphorus) * 100)), eval: eval_.phosphorus || '适中', evalColor: EVAL_COLOR[eval_.phosphorus] || '#FF7A45', barColor: EVAL_COLOR[eval_.phosphorus] || '#FF7A45', icon: '🦴' },
      { key: 'sodium', label: '钠', unit: 'mg', value: nut.sodium || 0, dailyRef: limits.sodium, percent: Math.min(100, Math.round(((nut.sodium || 0) / limits.sodium) * 100)), eval: eval_.sodium || '适中', evalColor: EVAL_COLOR[eval_.sodium] || '#722ED1', barColor: EVAL_COLOR[eval_.sodium] || '#722ED1', icon: '🧂' },
    ];

    // 食材列表
    const ingredients = (res.ingredients || []).map(ing => ({
      ...ing,
      safeColor: SAFE_COLOR[ing.safe] || SAFE_COLOR.warning,
      categoryIcon: { '主料': '🥩', '辅料': '🥬', '调料': '🧄' }[ing.category] || '🍽️',
    }));

    // 烹饪方式
    const cookMethodIcons = { '蒸': '♨️', '煮': '🫕', '炖': '🍲', '清炒': '🥘', '焯水': '💧', '炸': '🛢️', '烤': '🔥', '腌制': '🫙' };
    const cookMethod = res.cookMethod || { recommended: [], avoid: [] };
    const cookMethodDisplay = {
      recommended: (cookMethod.recommended || []).map(m => ({ name: m, icon: cookMethodIcons[m] || '✅' })),
      avoid: (cookMethod.avoid || []).map(m => ({ name: m, icon: cookMethodIcons[m] || '❌' })),
    };

    // 替代推荐
    const alternatives = (res.alternatives || []).map(alt => ({
      ...alt,
      scoreColor: (alt.score || 0) >= 75 ? '#52C41A' : (alt.score || 0) >= 40 ? '#FAAD14' : '#FF4D4F',
      safeLevelIcon: alt.safeLevel === 'safe' ? '✅' : '⚠️',
    }));

    return {
      ...res,
      levelCfg,
      score,
      scoreColor,
      nutritionBars,
      ingredients,
      cookMethodDisplay,
      alternatives,
    };
  },

  // ────── 展开/折叠 ────────────────────────────
  toggleIngredients() { this.setData({ ingredientsExpanded: !this.data.ingredientsExpanded }); },
  toggleSteps() { this.setData({ stepsExpanded: !this.data.stepsExpanded }); },
  toggleNutrition() { this.setData({ nutritionExpanded: !this.data.nutritionExpanded }); },

  // ────── 重新分析 ──────────────────────────────
  retryAnalyze() {
    this.startAnalyze();
  },

  // ────── 收藏 ──────────────────────────────────
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

  // ────── 记录饮食（分量选择）───────────────────
  addToRecord() {
    const { result } = this.data;
    if (!result) return;
    // 直接使用 servingGrams 作为默认克数
    const defaultGrams = result.servingGrams || 150;
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
    // 禁止背景滚动
    wx.setPageStyle({
      style: {
        overflow: 'hidden'
      }
    });
    this._updatePortionNutrients(defaultGrams);
  },

  // ── 选择餐段 ──
  selectMealType(e) {
    this.setData({ selectedMealType: e.currentTarget.dataset.value });
  },

  _updatePortionNutrients(grams) {
    const { result, stage } = this.data;
    if (!result || !result.nutrition) return;
    const nut = result.nutrition;
    // nutrition中的数值是整份的总量，用 servingGrams 作为基准
    const baseGrams = result.servingGrams || 200;
    const factor = grams / baseGrams; // 用实际基准重量计算缩放系数
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

  onPortionChanging(e) {
    const grams = e.detail.value;
    this.setData({ portionGrams: grams });
    this._updatePortionNutrients(grams);
  },

  onPortionChange(e) {
    const grams = e.detail.value;
    this.setData({ portionGrams: grams });
    this._updatePortionNutrients(grams);
  },

  closePortionModal() { 
    this.setData({ showPortionModal: false }); 
    // 恢复背景滚动
    wx.setPageStyle({
      style: {
        overflow: 'auto'
      }
    });
  },

  // ── 阻止事件冒泡 ──
  stopPropagation() {},

  async confirmRecord() {
    const { result, portionGrams, portionNutrients } = this.data;
    if (!result) return;

    const calcNutrition = {};
    portionNutrients.forEach(n => { calcNutrition[n.key] = n.value; });

    try {
      await addDietRecord(formatDate(new Date()), {
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

  // ────── 查看替代菜品 ──────────────────────────
  viewAlternative(e) {
    const name = e.currentTarget.dataset.name;
    wx.navigateTo({
      url: `/pages/recipes/detail/index?dish=${encodeURIComponent(name)}&stage=${this.data.stage}`,
    });
  },

  // ────── 去开通 VIP ────────────────────────────
  goVip() {
    wx.navigateTo({ url: '/pages/vip/index/index' });
  },

  // ────── 分享 ──────────────────────────────────
  onShareAppMessage() {
    const { result, dishName } = this.data;
    return {
      title: result ? `📷 ${result.dishName} - 肾友安全等级：${result.safeLevelLabel}` : `📷 拍照分析 - 肾友食光`,
      path: '/pages/recipes/index/index',
    };
  },
});
