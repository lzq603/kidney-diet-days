// pages/recipes/index/index.js - 食谱主页逻辑
const app = getApp();
const { fetchFavorites, calcNutrition, formatDate, getCurrentStage } = require('../../../utils/storage');
const { request } = require('../../../utils/request');

// 每日推荐展示数量
const DAILY_RECOMMEND_COUNT = 4;

const QUICK_TAGS = ['蔬菜类', '主食类', '肉类', '豆制品', '水果类'];

Page({
  data: {
    searchText: '',
    isFocused: false,
    autoFocus: false,
    analyzing: false,
    stageName: '',
    todayDate: '',
    todayNutrition: [],
    favorites: [],
    recommended: [],          // 每日轮换推荐（从食谱库中选取）
    refreshing: false,        // 是否正在刷新
    quickTags: QUICK_TAGS,
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.initPage();
  },

  async initPage() {
    const stage = app.globalData.currentStage || getCurrentStage() || '3a';
    const stageConfig = app.globalData.stageConfig || {};
    const stageName = stageConfig[stage]?.name || `CKD ${stage}期`;

    if (app.refreshTodayNutrition && (!app.isTodayNutritionFresh || !app.isTodayNutritionFresh())) {
      await app.refreshTodayNutrition(true);
    } else if (app.calcTodayNutrition) {
      app.calcTodayNutrition();
    }

    const now = new Date();
    const todayDate = `${now.getMonth() + 1}月${now.getDate()}日`;

    // ── 今日营养摄入（按当前日期从 globalData 读）──
    const stageLimit = stageConfig[stage] || { potassium: 3000, phosphorus: 800, sodium: 1800, protein: 0.8 };
    const proteinDaily = Number(stageLimit.protein_g || stageLimit.protein * 70 || 56);
    const sodiumDaily = Number(stageLimit.sodium || 1800);

    // ★ 直接读 globalData.todayNutrition（_startApp 中 calcTodayNutrition 已填入真实值）
    // 不再调用本地 calcNutrition()，避免读到空缓存返回全0
    const nut = app.globalData.todayNutrition || {};

    const todayNutrition = [
      {
        key: 'protein', label: '蛋白质', unit: 'g',
        value: (Number(nut.protein) || 0).toFixed(1),
        percent: Math.min(100, Math.round(((Number(nut.protein) || 0) / proteinDaily) * 100)),
        color: '#52C41A'
      },
      {
        key: 'potassium', label: '钾', unit: 'mg',
        value: Math.round(Number(nut.potassium) || 0),
        percent: Math.min(100, Math.round(((Number(nut.potassium) || 0) / stageLimit.potassium) * 100)),
        color: '#FAAD14'
      },
      {
        key: 'phosphorus', label: '磷', unit: 'mg',
        value: Math.round(Number(nut.phosphorus) || 0),
        percent: Math.min(100, Math.round(((Number(nut.phosphorus) || 0) / stageLimit.phosphorus) * 100)),
        color: '#FF7A45'
      },
      {
        key: 'sodium', label: '钠', unit: 'mg',
        value: Math.round(Number(nut.sodium) || 0),
        percent: Math.min(100, Math.round(((Number(nut.sodium) || 0) / sodiumDaily) * 100)),
        color: '#722ED1'
      },
    ];

    // ── 收藏列表（需登录）──
    let favorites = [];
    if (app.globalData.isLoggedIn) {
      try {
        favorites = await fetchFavorites();
      } catch (_) {
        favorites = [];
      }
    }

    this.setData({
      stageName,
      todayDate,
      todayNutrition,
      favorites: favorites.slice(0, 8),
    });

    // 异步拉取每日推荐（不阻塞页面渲染）
    this.fetchDailyRecommendations().then(recommended => {
      this.setData({ recommended });
    });
  },

  /**
   * 从后端获取每日推荐食谱
   * @param {boolean} refresh - true 表示"换一批"，强制重新随机
   */
  async fetchDailyRecommendations(refresh = false) {
    try {
      const params = `?count=${DAILY_RECOMMEND_COUNT}${refresh ? '&refresh=1' : ''}`;
      const res = await request({
        url: `/recipes/daily/${params}`,
        method: 'GET',
      });
      if (res && res.success && Array.isArray(res.items)) {
        return res.items.map(r => ({
          name: r.name,
          safeLevel: r.safeLevel,
          desc: r.desc,
          category: r.category || '',
          nutrition: [
            { label: '蛋白质', value: r.nutrition.protein },
            { label: '钾', value: r.nutrition.potassium },
            { label: '磷', value: r.nutrition.phosphorus },
            { label: '钠', value: r.nutrition.sodium },
            { label: '热量', value: r.nutrition.calories },
          ],
          tags: r.tags || [],
        }));
      }
    } catch (err) {
      console.warn('[推荐食谱] API 请求失败，推荐区暂不显示', err);
    }
    return [];
  },

  onSearchInput(e) {
    this.setData({ searchText: e.detail.value });
  },

  onFocus() { this.setData({ isFocused: true }); },
  onBlur() { this.setData({ isFocused: false }); },

  clearSearch() {
    this.setData({ searchText: '' });
  },

  tapQuickTag(e) {
    const tag = e.currentTarget.dataset.tag;
    wx.navigateTo({
      url: `/pages/recipes/category/index?category=${encodeURIComponent(tag)}`,
    });
  },

  goToFoods() {
    wx.navigateTo({ url: '/pages/foods/index/index' });
  },

  /**
   * 拍照/选图 → 识别食材 → 跳转图片分析页
   */
  takePhoto() {
    const that = this;
    this.setData({ isFocused: false });

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      camera: 'back',
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;

        wx.showLoading({ title: 'AI 正在识别…', mask: true });

        wx.getFileSystemManager().readFile({
          filePath: tempFilePath,
          encoding: 'base64',
          success(fileRes) {
            const imageBase64 = fileRes.data;

            request({
              url: '/recipes/recognize/',
              method: 'POST',
              data: { image: imageBase64 },
            })
              .then(recognizeRes => {
                wx.hideLoading();

                if (recognizeRes && recognizeRes.success) {
                  const dishName = recognizeRes.dish_name;
                  wx.navigateTo({
                    url: `/pages/recipes/photo-analyze/index?imageBase64=${encodeURIComponent(imageBase64)}&dishName=${encodeURIComponent(dishName)}&confidence=${recognizeRes.confidence || 'medium'}`,
                  });
                } else {
                  wx.showToast({
                    title: recognizeRes?.error || '识别失败，请重试',
                    icon: 'none',
                    duration: 2500,
                  });
                }
              })
              .catch(err => {
                wx.hideLoading();
                console.error('[拍照识别] 失败:', err);
                wx.showToast({ title: '网络错误，请重试', icon: 'none', duration: 2000 });
              });
          },
          fail() {
            wx.hideLoading();
            wx.showToast({ title: '图片读取失败', icon: 'none' });
          },
        });
      },
      fail() {
        // 用户取消选择，静默处理
      },
    });
  },

  doAnalyze() {
    const { searchText, analyzing } = this.data;
    if (!searchText.trim()) {
      wx.showToast({ title: '请输入菜品或食材名称', icon: 'none' });
      return;
    }
    if (analyzing) return;
    wx.navigateTo({
      url: `/pages/recipes/detail/index?dish=${encodeURIComponent(searchText.trim())}`,
    });
  },

  viewFavorite(e) {
    const item = this.data.favorites[e.currentTarget.dataset.index];
    wx.navigateTo({
      url: `/pages/recipes/detail/index?dish=${encodeURIComponent(item.name)}&fromCache=1`,
    });
  },

  viewRecommended(e) {
    const item = this.data.recommended[e.currentTarget.dataset.index];
    wx.navigateTo({
      url: `/pages/recipes/detail/index?dish=${encodeURIComponent(item.name)}`,
    });
  },

  async refreshRecommend() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    const recommended = await this.fetchDailyRecommendations(true);
    if (recommended) {
      this.setData({ recommended, refreshing: false });
    } else {
      this.setData({ refreshing: false });
    }
  },

  goToCategory() {
    wx.navigateTo({
      url: '/pages/recipes/category/index',
    });
  },

  // 分享给朋友
  onShareAppMessage() {
    return {
      title: '肾友食光 - 专为肾病患者设计的食谱库',
      path: '/pages/recipes/index/index',
      imageUrl: '/images/share-cover.jpg',
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '肾友食光 - 专为肾病患者设计的食谱库',
      imageUrl: '/images/share-cover.jpg',
    }
  },
});
