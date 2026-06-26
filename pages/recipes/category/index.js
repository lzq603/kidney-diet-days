// pages/recipes/category/index.js - 菜谱库页面逻辑
const app = getApp();
const { request } = require('../../../utils/request');

const PAGE_SIZE = 30;

const LEVEL_FILTERS = [
  { key: '', label: '全部' },
  { key: 'safe', label: '✅ 推荐' },
  { key: 'warning', label: '⚠️ 适量' },
  { key: 'danger', label: '🚫 慎食' },
];

const RECIPE_CATEGORIES = ['全部', '蔬菜类', '主食类', '肉类', '豆制品', '水果类', '汤羹类'];

Page({
  data: {
    keyword: '',
    activeCategory: '',
    activeLevel: '',
    categories: RECIPE_CATEGORIES,
    levelFilters: LEVEL_FILTERS,
    recipes: [],
    total: 0,
    page: 1,
    loading: false,
    hasMore: true,
    listHeight: 500, // 动态计算
  },

  onLoad(options) {
    const category = decodeURIComponent(options.category || '');
    this.setData({
      activeCategory: category || '',
    });
    this.fetchRecipes(true);
    this._calcListHeight();
  },

  onShow() {
    // 每次显示时刷新
    if (this.data.recipes.length > 0) {
      this.fetchRecipes(true);
    }
  },

  /* ── 计算列表可用高度（屏幕 - 搜索栏 - 分类tab - 筛选栏） ── */
  _calcListHeight() {
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ listHeight: Math.max(300, Math.floor(sysInfo.windowHeight - 250)) });
  },

  /* ── 获取菜谱列表 ── */
  async fetchRecipes(reset = false) {
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

      const res = await request({ url: '/recipes/list/', method: 'GET', data: params });

      if (res && res.success) {
        const newItems = (res.items || []).map(item => ({
          ...item,
          nutrition: typeof item.nutrition === 'string'
            ? JSON.parse(item.nutrition || '{}')
            : item.nutrition || {},
        }));

        const recipes = reset ? newItems : [...this.data.recipes, ...newItems];
        const hasMore = newItems.length >= PAGE_SIZE;

        this.setData({
          recipes,
          total: res.total || 0,
          page: reset ? 2 : page + 1,
          hasMore,
          loading: false,
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (e) {
      console.error('[菜谱列表] 请求失败', e);
      this.setData({ loading: false });
      if (!this.data.recipes.length) {
        wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      }
    }
  },

  /* ── 加载更多 ── */
  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.fetchRecipes(false);
  },

  /* ── 搜索输入 ── */
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value.trim() });
  },

  doSearch() {
    this.fetchRecipes(true);
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.fetchRecipes(true);
  },

  /* ── 分类选择 ── */
  selectCategory(e) {
    const cat = e.currentTarget.dataset.cat;
    this.setData({ activeCategory: cat });
    this.fetchRecipes(true);
  },

  /* ── 安全等级筛选 ── */
  selectLevel(e) {
    const level = e.currentTarget.dataset.level;
    this.setData({ activeLevel: level === this.data.activeLevel ? '' : level });
    this.fetchRecipes(true);
  },

  /* ── 点击查看详情 ── */
  viewDetail(e) {
    const index = e.currentTarget.dataset.index;
    const recipe = this.data.recipes[index];
    if (!recipe) return;

    wx.navigateTo({
      url: `/pages/recipes/detail/index?dish=${encodeURIComponent(recipe.name)}`,
    });
  },
});
