// pages/foods/index/index.js - 食材库页面逻辑
const app = getApp();
const { request } = require('../../../utils/request');

const PAGE_SIZE = 30;

const LEVEL_FILTERS = [
  { key: '', label: '全部' },
  { key: 'safe', label: '✅ 推荐' },
  { key: 'warning', label: '⚠️ 适量' },
  { key: 'danger', label: '🚫 慎食' },
];

Page({
  data: {
    keyword: '',
    activeCategory: '',
    activeLevel: '',
    categories: [],
    levelFilters: LEVEL_FILTERS,
    foods: [],
    total: 0,
    page: 1,
    loading: false,
    hasMore: true,
    listHeight: 500, // 动态计算
  },

  onLoad() {
    this.fetchCategories();
    this.fetchFoods(true);
    this._calcListHeight();
  },

  onShow() {
    // 每次显示时刷新（可能从其他页面返回）
    if (this.data.foods.length > 0) {
      this.fetchFoods(true);
    }
  },

  /* ── 计算列表可用高度（屏幕 - 搜索栏 - 分类tab - 筛选栏） ── */
  _calcListHeight() {
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    // 搜索栏 ~100 + 分类 tab ~60 + 筛选栏 ~50 + padding ~40 ≈ 250
    const listHeight = sysInfo.windowHeight * (sysInfo.pixelRatio || 2) / (sysInfo.pixelRatio || 2) - 250;
    this.setData({ listHeight: Math.max(300, Math.floor(sysInfo.windowHeight - 250)) });
  },

  /* ── 获取分类列表 ── */
  async fetchCategories() {
    try {
      const res = await request({ url: '/foods/categories/', method: 'GET' });
      if (res && res.success && Array.isArray(res.categories)) {
        this.setData({
          categories: ['全部', ...res.categories.map(c => c.name)],
        });
      }
    } catch (e) {
      console.warn('[食材分类] 获取失败', e);
    }
  },

  /* ── 获取食材列表 ── */
  async fetchFoods(reset = false) {
    if (this.data.loading && !reset) return;

    const page = reset ? 1 : this.data.page;

    this.setData({ loading: true });

    try {
      const params = {
        page,
        page_size: PAGE_SIZE,
      };

      if (this.data.keyword) params.keyword = this.data.keyword;
      if (this.data.activeCategory && this.data.activeCategory !== '全部') {
        params.category = this.data.activeCategory;
      }
      if (this.data.activeLevel) params.safe_level = this.data.activeLevel;

      const res = await request({ url: '/foods/list/', method: 'GET', data: params });

      if (res && res.success) {
        const newItems = (res.items || []).map(item => ({
          ...item,
          // 数值格式化：整数显示整数，小数保留1位
          nutrition: {
            calories: this._fmtNum(item.nutrition?.calories),
            protein: this._fmtNum(item.nutrition?.protein),
            fat: this._fmtNum(item.nutrition?.fat),
            carbs: this._fmtNum(item.nutrition?.carbs),
            potassium: this._fmtNum(item.nutrition?.potassium, 0),
            phosphorus: this._fmtNum(item.nutrition?.phosphorus, 0),
            sodium: item.nutrition?.sodium > 100
              ? Math.round(item.nutrition.sodium)
              : this._fmtNum(item.nutrition.sodium, 1),
          },
        }));

        const foods = reset ? newItems : [...this.data.foods, ...newItems];
        const hasMore = newItems.length >= PAGE_SIZE;

        this.setData({
          foods,
          total: res.total || 0,
          page: reset ? 2 : page + 1,
          hasMore,
          loading: false,
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (e) {
      console.error('[食材列表] 请求失败', e);
      this.setData({ loading: false });
      if (!this.data.foods.length) {
        wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      }
    }
  },

  /* ── 数字格式化 ── */
  _fmtNum(val, decimals = 1) {
    const n = Number(val) || 0;
    return n === Math.round(n) ? Math.round(n) : n.toFixed(decimals);
  },

  /* ── 加载更多 ── */
  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.fetchFoods(false);
  },

  /* ── 搜索输入 ── */
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value.trim() });
  },

  doSearch() {
    this.fetchFoods(true);
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.fetchFoods(true);
  },

  /* ── 分类选择 ── */
  selectCategory(e) {
    const cat = e.currentTarget.dataset.cat;
    this.setData({ activeCategory: cat });
    this.fetchFoods(true);
  },

  /* ── 安全等级筛选 ── */
  selectLevel(e) {
    const level = e.currentTarget.dataset.level;
    this.setData({ activeLevel: level === this.data.activeLevel ? '' : level });
    this.fetchFoods(true);
  },
});
