// pages/empty/index.js - 启动分流页：根据后端配置跳转到四则运算或正式页面
const app = getApp();
const { getCurrentStage } = require('../../utils/storage');
const { request } = require('../../utils/request');

Page({
  data: {
    loading: true,
    error: '',
  },

  onLoad() {
    this.getConfigAndRedirect();
  },

  async getConfigAndRedirect() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request({ url: '/config1/', method: 'GET' });
      if (res && res.success) {
        this.redirectBasedOnConfig(res.data || {});
      } else {
        this.redirectToMathTest();
      }
    } catch (err) {
      console.warn('[Empty] 获取启动配置失败，进入 math-test:', err);
      this.redirectToMathTest();
    }
  },

  redirectToMathTest() {
    wx.redirectTo({ url: '/pages/math-test/index' });
  },

  redirectBasedOnConfig(config) {
    const targetPage = config.targetPage || 'math-test';
    // const targetPage = 'index';
    const delay = Number(config.delay || 0) || 0;

    console.log(`[Empty] 启动配置 targetPage=${targetPage}, delay=${delay}`);

    setTimeout(() => {
      if (targetPage === 'index') {
        this.redirectToOfficial();
        return;
      }
      wx.redirectTo({ url: '/pages/math-test/index' });
    }, delay);
  },

  async redirectToOfficial() {
    // 正式流程：先等待自动登录/服务端资料同步完成，再根据是否已选择分期跳转。
    if (app.globalData._startPromise) {
      try { await app.globalData._startPromise; } catch (_) {}
    }

    const stage = app.globalData.currentStage || getCurrentStage();
    if (stage) {
      wx.switchTab({ url: '/pages/index/index' });
    } else {
      wx.redirectTo({ url: '/pages/onboard/index' });
    }
  },

  retry() {
    this.getConfigAndRedirect();
  },
});
