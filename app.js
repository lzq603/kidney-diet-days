// app.js - 肾友食光应用入口
// 数据全部从服务端获取，本地仅缓存 auth_token
const { syncFromServer, getProfileSync, getCurrentStage, getNickname, getDietRecords, fetchDietRecords } = require('./utils/storage');

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    apiBaseUrl: 'http://127.0.0.1:8000/ckd2/api',
    // 肾功能分期配置
    stageConfig: {
      '1': { name:'CKD 1期', protein: 1.0, potassium: 4000, phosphorus: 1000, sodium: 2300 },
      '2': { name:'CKD 2期', protein: 0.8, potassium: 3500, phosphorus: 900, sodium: 2000 },
      '3a':{ name:'CKD 3a期',protein: 0.8, potassium: 3000, phosphorus: 800,  sodium: 1800 },
      '3b':{ name:'CKD 3b期',protein: 0.6, potassium: 2500, phosphorus: 700,  sodium: 1500 },
      '4': { name:'CKD 4期', protein: 0.6, potassium: 2000, phosphorus: 600, sodium: 1500 },
      '5': { name:'CKD 5期', protein: 0.6, potassium: 2000, phosphorus: 600, sodium: 1200 },
      'dialysis': { name:'透析期', protein: 1.2, potassium: 2000, phosphorus: 600, sodium: 1500 },
    },
    currentStage: '',
    todayNutrition: null,
    todayNutritionDate: '',
    // ★ _startApp 的 Promise，让登录页可以 await 它
    _startPromise: null,
  },

  onLaunch() {
    const token = wx.getStorageSync('auth_token');
    if (token) {
      this.globalData.isLoggedIn = true;
      // 启动数据加载，保存 Promise 引用供页面 await，避免 WebSocket 早于登录态建立。
      this.globalData._startPromise = this._startApp();
    } else {
      // 自动登录也必须保存 Promise，否则首页 onLoad 无法等待 token 写入。
      this.globalData._startPromise = this._autoLogin();
    }
  },

  // 静默自动登录 + 启动（串行，完成后自动跳转）
  async _autoLogin() {
    try {
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({ success: resolve, fail: reject });
      });
      const { request } = require('./utils/request');
      const res = await request({
        url: '/auth/wx-login/',
        method: 'POST',
        data: { code: loginRes.code },
      });
      if (res?.token) {
        wx.setStorageSync('auth_token', res.token);
        this.globalData.isLoggedIn = true;
        console.log('[App] 自动登录成功');
        // 自动登录：串行完成 _startApp，页面自己根据分期决定是否进入引导页。
        await this._startApp();
      } else {
        throw new Error(res?.error || '自动登录无token');
      }
    } catch (err) {
      console.log(err);
      wx.showToast(err);
      console.warn('[App] 自动登录失败，降级启动:', err);
      this.globalData.isLoggedIn = false;
      this.globalData.currentStage = '';
      this.globalData.userInfo = { nickname: '肾友' };
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  /** 从服务端加载数据 → 写入 globalData → 返回 Promise */
  async _startApp() {
    try {
      await syncFromServer();

      const stage = getCurrentStage() || '';
      const nickname = getNickname();
      this.globalData.currentStage = stage;
      this.globalData.userInfo = { nickname };
      this.globalData.isLoggedIn = true;

      this.calcTodayNutrition();
      console.log('[App] _startApp 完成，todayNutrition:', JSON.stringify(this.globalData.todayNutrition));
    } catch (err) {
      console.warn('[App] 启动数据加载异常:', err);
      this.globalData.currentStage = '';
      this.globalData.userInfo = { nickname: '肾友' };
    }
  },

  async refreshTodayNutrition(forceRefresh = false) {
    if (forceRefresh) {
      await fetchDietRecords(true);
    }
    this.calcTodayNutrition();
    return this.globalData.todayNutrition;
  },

  calcTodayNutrition() {
    const today = this.getDateString(new Date());
    const records = getDietRecords(today);
    let nutrition = { calories: 0, protein: 0, potassium: 0, phosphorus: 0, sodium: 0 };
    records.forEach(r => {
      nutrition.calories += r.nutrition?.calories || 0;
      nutrition.protein += r.nutrition?.protein || 0;
      nutrition.potassium += r.nutrition?.potassium || 0;
      nutrition.phosphorus += r.nutrition?.phosphorus || 0;
      nutrition.sodium += r.nutrition?.sodium || 0;
    });
    this.globalData.todayNutrition = nutrition;
    this.globalData.todayNutritionDate = today;
  },

  isTodayNutritionFresh() {
    return this.globalData.todayNutritionDate === this.getDateString(new Date());
  },

  getDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
});
