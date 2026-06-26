// pages/records/index/index.js - 饮食记录页
const app = getApp();
const { fetchDietRecords, getDietRecords, addDietRecord, deleteDietRecord, updateDietRecord, formatDate, calcNutrition, getLast7Days, getCurrentStage } = require('../../../utils/storage');
const { request } = require('../../../utils/request');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MEAL_OPTIONS = [
  { label: '早餐', value: '早餐', icon: '🌅' },
  { label: '午餐', value: '午餐', icon: '☀️' },
  { label: '下午茶', value: '下午茶', icon: '🍵' },
  { label: '晚餐', value: '晚餐', icon: '🌙' },
];

Page({
  data: {
    weekdays: WEEKDAYS,
    currentYear: 0,
    currentMonth: 0,
    calendarDays: [],
    selectedDate: '',
    todayStr: '',
    dayRecords: [],
    mealGroups: [],
    dayStats: [],
    dayStatsDate: '',
    calorieBars: [],
    showAddModal: false,
    isEditing: false, // 是否是编辑模式
    editingRecordId: null, // 正在编辑的记录ID
    inputName: '',
    inputMealType: '早餐',
    mealOptions: MEAL_OPTIONS,
    mealTypeLabel: '',
    analyzingFood: false,
    analyzedFood: null,
    analyzedFoods: null, // 多食物分析结果
    isMultiFood: false, // 是否是多食物
    portionGrams: 150,
    portionMin: 1,
    portionMax: 500,
    portionStep: 1,
    portionNutrients: [],
    originalNutritionPer100g: null, // 原始每100g营养（用于编辑时重新计算）
  },

  async onLoad() {
    const today = new Date();
    const todayStr = formatDate(today);
    this.setData({
      currentYear: today.getFullYear(),
      currentMonth: today.getMonth() + 1,
      selectedDate: todayStr,
      todayStr,
    });
    await this.ensureAppReady();
    await fetchDietRecords();  // 确保数据已加载
    this.buildCalendar();
    this.loadDayRecords(todayStr);
    this.buildDayStats(todayStr);
  },

  async ensureAppReady() {
    if (app.globalData && app.globalData._startPromise) {
      try { await app.globalData._startPromise; } catch (_) {}
    }
    if (!wx.getStorageSync('auth_token') && app._autoLogin) {
      app.globalData._startPromise = app._autoLogin();
      try { await app.globalData._startPromise; } catch (_) {}
    }
  },

  async onShow() {
    await this.ensureAppReady();
    const currentToday = formatDate(new Date());
    const crossedDay = this.data.todayStr && this.data.todayStr !== currentToday;
    const selectedDate = crossedDay ? currentToday : (this.data.selectedDate || currentToday);

    if (crossedDay) {
      const today = new Date();
      this.setData({
        currentYear: today.getFullYear(),
        currentMonth: today.getMonth() + 1,
        selectedDate: currentToday,
        todayStr: currentToday,
      });
    }

    await fetchDietRecords(true);  // 每次显示刷新
    this.loadDayRecords(selectedDate);
    this.buildDayStats(selectedDate);
    this.buildCalendar();
    if (app.refreshTodayNutrition) await app.refreshTodayNutrition(false);
  },

  // 构建日历数据
  buildCalendar() {
    const { currentYear, currentMonth } = this.data;
    const allRecords = getDietRecords();
    const today = formatDate(new Date());

    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const startWeekday = firstDay.getDay();

    const days = [];

    // 上月补位
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1, -i);
      days.push({
        date: formatDate(d),
        day: d.getDate(),
        isCurrentMonth: false,
        isToday: false,
        hasRecord: false,
      });
    }

    // 当月
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateObj = new Date(currentYear, currentMonth - 1, d);
      const dateStr = formatDate(dateObj);
      days.push({
        date: dateStr,
        day: d,
        isCurrentMonth: true,
        isToday: dateStr === today,
        hasRecord: (allRecords[dateStr] || []).length > 0,
      });
    }

    // 下月补位（补满6行）
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const dateObj = new Date(currentYear, currentMonth, d);
      days.push({
        date: formatDate(dateObj),
        day: d,
        isCurrentMonth: false,
        isToday: false,
        hasRecord: false,
      });
    }

    this.setData({ calendarDays: days });
  },

  prevMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    this.setData({ currentYear, currentMonth });
    this.buildCalendar();
  },

  nextMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    this.setData({ currentYear, currentMonth });
    this.buildCalendar();
  },

  selectDay(e) {
    const { date, valid } = e.currentTarget.dataset;
    if (!valid) return;
    this.setData({ selectedDate: date });
    this.loadDayRecords(date);
    this.buildDayStats(date);
  },

  loadDayRecords(dateStr) {
    const records = getDietRecords(dateStr);

    // 按餐次分组
    const mealMap = {};
    records.forEach(r => {
      const mt = r.mealType || '其他';
      if (!mealMap[mt]) mealMap[mt] = [];
      mealMap[mt].push(r);
    });

    const mealOrder = ['早餐', '午餐', '下午茶', '晚餐', '其他'];
    const mealGroups = mealOrder
      .filter(mt => mealMap[mt])
      .map(mt => {
        const iconMap = { '早餐': '🌅', '午餐': '☀️', '下午茶': '🍵', '晚餐': '🌙', '其他': '🍴' };
        const totalCalories = mealMap[mt].reduce((s, r) => s + (r.nutrition?.calories || 0), 0);
        return { mealType: mt, icon: iconMap[mt] || '🍴', records: mealMap[mt], totalCalories: Math.round(totalCalories) };
      });

    this.setData({ dayRecords: records, mealGroups });
  },

  async deleteRecord(e) {
    const { date, id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除记录',
      content: '确认删除这条饮食记录？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await deleteDietRecord(date, id);
            this.loadDayRecords(date);
            this.buildCalendar();
            this.buildDayStats(date);
            app.calcTodayNutrition();
          } catch (err) {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  buildDayStats(dateStr) {
    const stage = app.globalData.currentStage || getCurrentStage() || '3a'
    const stageCfg = app.globalData.stageConfig?.[stage] || { potassium: 3000, phosphorus: 800, sodium: 1800, protein: 0.8 }

    const nut = calcNutrition(dateStr)

    // 修复：蛋白质每日限制和"我的"页面一致，用70kg算
    let proteinDaily = Number(stageCfg.protein_g || (stageCfg.protein * 70) || 56)
    if (!proteinDaily || proteinDaily <= 0) proteinDaily = 56

    const potassiumDaily  = Number(stageCfg.potassium  || 3000)
    const phosphorusDaily = Number(stageCfg.phosphorus || 800)
    const sodiumDaily     = Number(stageCfg.sodium     || 1800)

    const calories   = Number(nut.calories)   || 0
    const protein    = Number(nut.protein || nut.protein_g) || 0
    const potassium  = Number(nut.potassium)  || 0
    const phosphorus = Number(nut.phosphorus) || 0
    const sodium     = Number(nut.sodium)     || 0

    const dayStats = [
      {
        label: '热量', unit: 'kcal',
        value: Math.round(calories),
        percent: Math.min(100, Math.round((calories / 1800) * 100)),
        color: '#4A90D9',
      },
      {
        label: '蛋白质', unit: 'g',
        value: protein.toFixed(1),
        percent: Math.min(100, Math.round((protein / proteinDaily) * 100)),
        color: '#52C41A',
      },
      {
        label: '钾', unit: 'mg',
        value: Math.round(potassium),
        percent: Math.min(100, Math.round((potassium / potassiumDaily) * 100)),
        color: '#FAAD14',
      },
      {
        label: '磷', unit: 'mg',
        value: Math.round(phosphorus),
        percent: Math.min(100, Math.round((phosphorus / phosphorusDaily) * 100)),
        color: '#FF7A45',
      },
      {
        label: '钠', unit: 'mg',
        value: Math.round(sodium),
        percent: Math.min(100, Math.round((sodium / sodiumDaily) * 100)),
        color: '#722ED1',
      },
    ]

    // 近7日热量趋势（保持不变）
    const days7 = getLast7Days();
    const calorieBars = days7.map(d => {
      const n = calcNutrition(d);
      return {
        date: d,
        label: d.slice(8),
        calories: n.calories,
        height: 0,
        color: n.calories > 2000 ? '#FF4D4F' : n.calories > 1200 ? '#4A90D9' : '#BDC3C7',
      };
    });
    const maxCal = Math.max(...calorieBars.map(b => b.calories), 1);
    calorieBars.forEach(b => {
      b.height = Math.max(4, Math.round((b.calories / maxCal) * 100));
    });

    // 日期展示用，区分今天
    const todayStr = this.data.todayStr;
    const isToday = dateStr === todayStr;
    const [, m, d2] = dateStr.split('-');
    const dayStatsDate = isToday ? '今天' : `${Number(m)}月${Number(d2)}日`;

    this.setData({ dayStats, dayStatsDate, calorieBars });
  },

  addRecord() {
    const h = new Date().getHours();
    let mealType = '早餐';
    if (h >= 10 && h < 14) mealType = '午餐';
    else if (h >= 14 && h < 18) mealType = '下午茶';
    else if (h >= 18) mealType = '晚餐';
    this.setData({
      showAddModal: true,
      isEditing: false,
      editingRecordId: null,
      inputName: '',
      inputMealType: mealType,
      mealTypeLabel: mealType,
      analyzingFood: false,
      analyzedFood: null,
      analyzedFoods: null,
      isMultiFood: false,
      portionGrams: 150,
      portionMin: 1,
      portionMax: 500,
      portionStep: 1,
      portionNutrients: [],
      originalNutritionPer100g: null,
    });
  },

  editRecord(e) {
    const { date, id } = e.currentTarget.dataset;
    const records = getDietRecords(date);
    const record = records.find(r =>
      r.id === id || r.serverId === id || String(r.id) === String(id)
    );
    
    if (!record) return;

    // 计算每100g营养（用于编辑时重新计算）
    const originalNutritionPer100g = {};
    const portionGrams = record.portionGrams || 150;
    if (portionGrams > 0) {
      Object.keys(record.nutrition || {}).forEach(key => {
        originalNutritionPer100g[key] = (record.nutrition[key] || 0) / portionGrams * 100;
      });
    }

    // 构建analyzedFood对象
    const analyzedFood = {
      name: record.name,
      safeLevel: record.safeLevel,
      score: record.score,
      servingSize: `${portionGrams}g`,
      nutrition: originalNutritionPer100g,
      note: '',
    };

    this.setData({
      showAddModal: true,
      isEditing: true,
      editingRecordId: id,
      inputName: record.name,
      inputMealType: record.mealType || '早餐',
      mealTypeLabel: record.mealType || '早餐',
      analyzingFood: false,
      analyzedFood,
      analyzedFoods: null,
      isMultiFood: false,
      portionGrams,
      portionMin: 1,
      portionMax: 1000,
      portionStep: 1,
      portionNutrients: [],
      originalNutritionPer100g,
    });

    // 计算当前克数的营养
    this._updatePortionNutrients(portionGrams);
  },

  closeModal() {
    this.setData({
      showAddModal: false,
      analyzingFood: false,
      analyzedFood: null,
      analyzedFoods: null,
      isMultiFood: false,
      portionNutrients: [],
    });
  },

  onInputName(e) {
    this.setData({
      inputName: e.detail.value,
      analyzedFood: null,
      analyzedFoods: null,
      isMultiFood: false,
      portionNutrients: [],
    });
  },

  selectMealType(e) {
    const mealType = e.currentTarget.dataset.value;
    this.setData({ inputMealType: mealType, mealTypeLabel: mealType });
  },

  stopPropagation() {
    // 空方法，仅用于阻止事件冒泡到 modal-mask
  },

  async analyzeAndAdd() {
    const name = this.data.inputName.trim();
    if (!name) {
      wx.showToast({ title: '请输入食物名称', icon: 'none' });
      return;
    }

    this.setData({ analyzingFood: true, analyzedFood: null, analyzedFoods: null, isMultiFood: false, portionNutrients: [] });
    try {
      const stage = app.globalData.currentStage || getCurrentStage() || '3a';
      const res = await request({
        url: '/foods/nutrition-analyze/',
        method: 'POST',
        data: {
          food_name: name,
          ckd_stage: stage,
        },
      });

      if (!res || !res.success) {
        const msg = (res && res.error) || '营养分析失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }

      if (res.isMulti) {
        // 多食物结果
        const foods = res.data;
        this.setData({
          analyzedFoods: foods,
          isMultiFood: true,
        });
      } else {
        // 单食物结果（保持向后兼容）
        const food = res.data;
        const defaultGrams = this._parseServingGrams(food.servingSize) || 150;
        const maxGram = Math.max(500, defaultGrams * 2);
        this.setData({
          analyzedFood: food,
          isMultiFood: false,
          portionGrams: defaultGrams,
          portionMin: 1,
          portionMax: maxGram,
          portionStep: 1,
        });
        this._updatePortionNutrients(defaultGrams);
      }
    } catch (err) {
      const msg = (err && err.message) || '营养分析失败';
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ analyzingFood: false });
    }
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

  async confirmAddRecord() {
    const { analyzedFood, analyzedFoods, isMultiFood, portionNutrients, selectedDate, inputMealType, isEditing, editingRecordId } = this.data;
    
    if (isEditing) {
      // 编辑模式：更新记录
      const nutrition = {};
      portionNutrients.forEach(item => {
        nutrition[item.key] = item.value;
      });

      try {
        await updateDietRecord(selectedDate, editingRecordId, {
          name: analyzedFood.name,
          safeLevel: analyzedFood.safeLevel || 'warning',
          nutrition,
          mealType: inputMealType,
          portionGrams: this.data.portionGrams,
        });
        await fetchDietRecords(true);
        this.loadDayRecords(selectedDate);
        this.buildDayStats(selectedDate);
        this.buildCalendar();
        if (app.refreshTodayNutrition) await app.refreshTodayNutrition(false);
        else app.calcTodayNutrition();
        this.setData({ 
          showAddModal: false, 
          isEditing: false, 
          editingRecordId: null, 
          analyzedFood: null, 
          analyzedFoods: null, 
          isMultiFood: false, 
          portionNutrients: [],
          originalNutritionPer100g: null,
        });
        wx.showToast({ title: '已更新记录', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: '更新失败，请重试', icon: 'none' });
      }
    } else if (isMultiFood && analyzedFoods && analyzedFoods.length > 0) {
      // 批量添加多食物
      try {
        for (const food of analyzedFoods) {
          const nutrition = food.nutritionTotal || {};
          await addDietRecord(selectedDate, {
            name: food.name,
            safeLevel: food.safeLevel || 'warning',
            nutrition: {
              calories: nutrition.calories || 0,
              protein: nutrition.protein || 0,
              fat: nutrition.fat || 0,
              carbs: nutrition.carbs || 0,
              potassium: nutrition.potassium || 0,
              phosphorus: nutrition.phosphorus || 0,
              sodium: nutrition.sodium || 0,
            },
            score: food.score || 50,
            mealType: inputMealType,
            portionGrams: food.inputGrams || 100,
          });
        }
        await fetchDietRecords(true);
        this.loadDayRecords(selectedDate);
        this.buildDayStats(selectedDate);
        this.buildCalendar();
        if (app.refreshTodayNutrition) await app.refreshTodayNutrition(false);
        else app.calcTodayNutrition();
        this.setData({ showAddModal: false, analyzedFood: null, analyzedFoods: null, isMultiFood: false, portionNutrients: [] });
        wx.showToast({ title: `已记录 ${analyzedFoods.length} 个食物`, icon: 'success' });
      } catch (err) {
        wx.showToast({ title: '记录失败，请重试', icon: 'none' });
      }
    } else if (analyzedFood) {
      // 单食物添加（保持原逻辑）
      const nutrition = {};
      portionNutrients.forEach(item => {
        nutrition[item.key] = item.value;
      });

      try {
        await addDietRecord(selectedDate, {
          name: analyzedFood.name,
          safeLevel: analyzedFood.safeLevel || 'warning',
          nutrition,
          score: analyzedFood.score || 50,
          mealType: inputMealType,
          portionGrams: this.data.portionGrams,
        });
        await fetchDietRecords(true);
        this.loadDayRecords(selectedDate);
        this.buildDayStats(selectedDate);
        this.buildCalendar();
        if (app.refreshTodayNutrition) await app.refreshTodayNutrition(false);
        else app.calcTodayNutrition();
        this.setData({ showAddModal: false, analyzedFood: null, analyzedFoods: null, isMultiFood: false, portionNutrients: [] });
        wx.showToast({ title: `已记录 ${this.data.portionGrams}g`, icon: 'success' });
      } catch (err) {
        wx.showToast({ title: '记录失败，请重试', icon: 'none' });
      }
    } else {
      wx.showToast({ title: '请先分析营养含量', icon: 'none' });
      return;
    }
  },

  _updatePortionNutrients(grams) {
    const { analyzedFood } = this.data;
    if (!analyzedFood || !analyzedFood.nutrition) return;

    const nut = analyzedFood.nutrition;
    const factor = grams / 100;
    const items = [
      { key: 'calories', label: '热量', unit: 'kcal', value: (nut.calories || 0) * factor, color: '#4A90D9' },
      { key: 'protein', label: '蛋白质', unit: 'g', value: (nut.protein || 0) * factor, color: '#52C41A' },
      { key: 'potassium', label: '钾', unit: 'mg', value: (nut.potassium || 0) * factor, color: '#FAAD14' },
      { key: 'phosphorus', label: '磷', unit: 'mg', value: (nut.phosphorus || 0) * factor, color: '#FF7A45' },
      { key: 'sodium', label: '钠', unit: 'mg', value: (nut.sodium || 0) * factor, color: '#722ED1' },
    ].map(item => ({
      ...item,
      value: Math.round(item.value * 10) / 10,
    }));

    this.setData({ portionNutrients: items });
  },

  _parseServingGrams(servingSize) {
    const match = String(servingSize || '').match(/(\d+(?:\.\d+)?)\s*g/i);
    return match ? Math.round(Number(match[1])) : 0;
  },
});
