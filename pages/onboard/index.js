// pages/index/index.js - 引导页逻辑
const app = getApp();
const { saveProfileToServer, getCurrentStage } = require('../../utils/storage');

Page({
  data: {
    hasStage: false,
    selectedStage: '',
    features: [
      { icon: '🤖', title: 'AI智能分析', desc: '输入食材，智能判断肾友安全性' },
      { icon: '📋', title: '饮食记录', desc: '日历管理，追踪每日营养摄入' },
      { icon: '📊', title: '营养统计', desc: '可视化图表，掌握健康趋势' },
    ],
    stages: [
      { label: 'CKD 1期', value: '1', desc: '肾功能正常' },
      { label: 'CKD 2期', value: '2', desc: '轻度下降' },
      { label: 'CKD 3a期', value: '3a', desc: '轻中度' },
      { label: 'CKD 3b期', value: '3b', desc: '中度下降' },
      { label: 'CKD 4期', value: '4', desc: '重度下降' },
      { label: 'CKD 5期', value: '5', desc: '肾衰竭期' },
      { label: '透析期', value: 'dialysis', desc: '血液/腹膜透析' },
    ],
  },

  async onLoad() {
    // ★ 从服务端缓存读取分期（不再读本地 Storage）；等待自动登录/同步完成，避免误判。
    if (app.globalData._startPromise) {
      try { await app.globalData._startPromise; } catch (_) {}
    }
    const stage = app.globalData.currentStage || getCurrentStage();
    if (stage) {
      this.setData({ hasStage: true, selectedStage: stage });
      // 已设置过分期，直接跳转到首页（AI 对话）
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  selectStage(e) {
    this.setData({ selectedStage: e.currentTarget.dataset.value });
  },

  async goToMain() {
    const { selectedStage } = this.data;
    if (!selectedStage) {
      wx.showToast({ title: '请先选择肾功能分期', icon: 'none' });
      return;
    }
    // ★ 只通过后端保存，不再写本地 Storage
    app.globalData.currentStage = selectedStage;
    try {
      await saveProfileToServer({ nickname: '肾友', ckdStage: selectedStage });
    } catch (err) {
      console.warn('[Index] 保存分期到后端失败:', err);
    }
    wx.switchTab({ url: '/pages/index/index' });
  },
});
