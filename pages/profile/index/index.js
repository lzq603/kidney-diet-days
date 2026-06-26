// pages/profile/index/index.js - 个人中心
const app = getApp();
const { calcNutrition, formatDate, clearAllCache, saveProfileToServer, getNickname, getCurrentStage, fetchDietRecords } = require('../../../utils/storage');
const { request } = require('../../../utils/request');

const STAGES = [
  { label: 'CKD 1期', value: '1' },
  { label: 'CKD 2期', value: '2' },
  { label: 'CKD 3a期', value: '3a' },
  { label: 'CKD 3b期', value: '3b' },
  { label: 'CKD 4期', value: '4' },
  { label: 'CKD 5期', value: '5' },
  { label: '透析期', value: 'dialysis' },
];

const CKD_TYPES = [
  { label: '未选择', value: '' },
  { label: '慢性肾小球肾炎', value: 'chronic_glomerulonephritis' },
  { label: '糖尿病肾病', value: 'diabetic_nephropathy' },
  { label: '高血压肾病', value: 'hypertensive_nephropathy' },
  { label: '多囊肾', value: 'polycystic_kidney' },
  { label: '狼疮性肾炎', value: 'lupus_nephritis' },
  { label: '紫癜性肾炎', value: 'purpuric_nephritis' },
  { label: '梗阻性肾病', value: 'obstructive_nephropathy' },
  { label: '间质性肾炎', value: 'interstitial_nephritis' },
  { label: '其他', value: 'other' },
];

Page({
  data: {
    nickname: '肾友',
    nickInitial: '肾',
    stageName: '',
    ckdTypeName: '',
    cacheSize: '',
    showSettings: false,
    editNickname: '',
    editStage: '',
    editCkdType: '',
    ckdTypeIndex: 0,
    editGender: '',
    editHeightCm: '',
    editWeightKg: '',
    editBirthYear: '',
    genderOptions: ['男', '女', '其他'],
    genderValues: ['male', 'female', 'other'],
    stages: STAGES,
    ckdTypes: CKD_TYPES,
    bmi: null,
  },

  onLoad() {
    this.loadProfile();
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    const stage = app.globalData.currentStage || getCurrentStage() || '3a';
    const stageConfig = app.globalData.stageConfig || {};
    const stageCfg = stageConfig[stage] || { potassium: 3000, phosphorus: 800, sodium: 2000, protein: 0.8 };
    const stageName = stageCfg.name || `CKD ${stage}期`;

    const nickname = getNickname();
    const nickInitial = nickname.slice(0, 1);

    let ckdTypeName = '';
    try {
      const res = await request({ url: '/user/profile/', method: 'GET' });
      if (res && res.success && res.data && res.data.ckd_type) {
        const ckdType = CKD_TYPES.find(t => t.value === res.data.ckd_type);
        ckdTypeName = ckdType ? ckdType.label : '';
      }
    } catch (_) {}

    const allRecords = (await fetchDietRecords()) || {};
    const recCount = Object.values(allRecords).reduce((s, v) => s + v.length, 0);
    const cacheSize = recCount > 0 ? `约${recCount}条记录` : '无记录';

    this.setData({
      nickname, nickInitial, stageName, ckdTypeName, cacheSize,
      editNickname: nickname, editStage: stage,
    });

    this._loadUserProfile();
  },

  openSettings() {
    this.setData({ showSettings: true });
  },

  closeSettings() {
    this.setData({ showSettings: false });
  },

  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value });
  },

  selectEditStage(e) {
    this.setData({ editStage: e.currentTarget.dataset.value });
  },

  selectEditGender(e) {
    this.setData({ editGender: e.currentTarget.dataset.value });
  },

  onCkdTypeChange(e) {
    const index = e.detail.value;
    this.setData({
      ckdTypeIndex: index,
      editCkdType: CKD_TYPES[index].value
    });
  },

  onHeightInput(e) {
    this.setData({ editHeightCm: e.detail.value });
  },

  onWeightInput(e) {
    this.setData({ editWeightKg: e.detail.value });
  },

  onBirthYearInput(e) {
    this.setData({ editBirthYear: e.detail.value });
  },

  stopPropagation() {
  },

  async _loadUserProfile() {
    try {
      const res = await request({ url: '/user/profile/', method: 'GET' });
      if (res && res.success && res.data) {
        const d = res.data;
        let ckdTypeName = '';
        let ckdTypeIndex = 0;
        if (d.ckd_type) {
          const ckdType = CKD_TYPES.find(t => t.value === d.ckd_type);
          ckdTypeName = ckdType ? ckdType.label : '';
          ckdTypeIndex = ckdType ? CKD_TYPES.indexOf(ckdType) : 0;
        }
        this.setData({
          editGender: d.gender || '',
          editHeightCm: d.height_cm || '',
          editWeightKg: d.weight_kg || '',
          editBirthYear: d.birth_year || '',
          editCkdType: d.ckd_type || '',
          ckdTypeIndex: ckdTypeIndex,
          ckdTypeName: ckdTypeName,
          bmi: d.bmi,
        });
      }
    } catch (_) {}
  },

  async saveSettings() {
    const { editNickname, editStage, editCkdType, editGender, editHeightCm, editWeightKg, editBirthYear } = this.data;
    if (!editNickname.trim()) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }

    try {
      await saveProfileToServer({
        nickname: editNickname.trim(),
        ckdStage: editStage,
        ckdType: editCkdType,
        gender: editGender,
        height_cm: editHeightCm ? Number(editHeightCm) : null,
        weight_kg: editWeightKg ? Number(editWeightKg) : null,
        birth_year: editBirthYear ? Number(editBirthYear) : null,
      });

      app.globalData.currentStage = editStage;
      app.globalData.userInfo = { nickname: editNickname.trim() };

      this.setData({ showSettings: false });
      this.loadProfile();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  showStageSelect() {
    this.setData({ showSettings: true });
  },

  async clearCache() {
    wx.showModal({
      title: '清除记录',
      content: '将清除所有饮食记录和收藏食谱，此操作不可撤销，确认继续？',
      success: async (res) => {
        if (res.confirm) {
          await clearAllCache();
          await this.loadProfile();
          wx.showToast({ title: '记录已清除', icon: 'success' });
        }
      }
    });
  },

  goReports() {
    const app = getApp()
    if (!app.globalData.isLoggedIn) {
      app.checkLogin ? app.checkLogin() : wx.navigateTo({ url: '/pages/login/index/index' })
      return
    }
    wx.navigateTo({ url: '/pages/reports/index/index' })
  },

  goDietRecords() {
    const app = getApp()
    if (!app.globalData.isLoggedIn) {
      app.checkLogin ? app.checkLogin() : wx.navigateTo({ url: '/pages/login/index/index' })
      return
    }
    wx.switchTab({ url: '/pages/records/index/index' })
  },

  viewHelp() {
    wx.showModal({
      title: '使用帮助',
      content: `📖 使用说明\n\n1. 在"食谱"页输入菜品名称，AI将分析肾友安全性\n2. 查看详细做法和营养数据\n3. 将食物记录到当天饮食\n4. 在"记录"页查看日历和营养统计\n5. 在"我的"中设置肾功能分期获取个性化建议`,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  viewDisclaimer() {
    wx.showModal({
      title: '医疗免责声明',
      content: `⚕️ 重要声明\n\n本应用提供的饮食建议和营养数据仅供参考，不能替代专业医疗建议。\n\n如有疾病相关问题，请及时咨询肾病科医生或营养师。不同患者的个体情况不同，饮食方案应在医生指导下制定。`,
      showCancel: false,
      confirmText: '我已了解',
    });
  },

  showAbout() {
    wx.showModal({
      title: '关于肾友食光',
      content: `🫘 肾友食光 v1.0.0\n\n专为肾炎患者设计的饮食管理助手\n\n开源项目，欢迎贡献代码\n\n联系方式：lizq603`,
      showCancel: false,
      confirmText: '关闭',
    });
  },
});
