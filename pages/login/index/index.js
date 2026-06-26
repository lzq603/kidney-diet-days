// pages/login/index.js - 微信登录页（透明中转页）
// 流程：等待 app._startApp() 完成后跳转首页
const { request } = require('../../../utils/request');

Page({
  data: {},  // 空数据，页面全透明

  onLoad() {
    this._waitForReadyAndGo();
  },

  async _waitForReadyAndGo() {
    const app = getApp();

    // 等待 _startApp 完成（如果已有 Promise）
    if (app.globalData._startPromise) {
      try {
        await app.globalData._startPromise;
      } catch (_) {
        // _startApp 失败也放行，降级使用
      }
    }

    // 跳转到首页
    wx.switchTab({ url: '/pages/recipes/index/index' });
  },
});
