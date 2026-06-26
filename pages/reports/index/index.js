// pages/reports/index/index.js — 检查报告列表 + 上传
const { request } = require('../../../utils/request')

Page({
  data: {
    reports: [],
    loading: true,
    uploading: false,
  },

  onLoad() {
    this.loadReports()
  },

  onShow() {
    this.loadReports()
  },

  async loadReports() {
    this.setData({ loading: true })
    try {
      const res = await request({ url: '/health-reports/', method: 'GET' })
      if (res && res.success) {
        this.setData({ reports: res.data || [] })
      }
    } catch (_) {}
    this.setData({ loading: false })
  },

  onUploadTap() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album']
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType,
          sizeType: ['compressed'],
          success: (mediaRes) => {
            const tempPath = mediaRes.tempFiles[0].tempFilePath
            this.analyzeReport(tempPath)
          },
        })
      },
    })
  },

  async analyzeReport(filePath) {
    this.setData({ uploading: true })
    wx.showLoading({ title: 'AI 识别报告中...', mask: true })

    try {
      // 转 base64
      const fs = wx.getFileSystemManager()
      const base64 = fs.readFileSync(filePath, 'base64')

      const res = await request({
        url: '/health-reports/analyze/',
        method: 'POST',
        data: { image: base64 },
        timeout: 120000,  // AI 识别可能需要更长时间
      })

      wx.hideLoading()

      if (res && res.success) {
        wx.showToast({ title: `识别完成，共 ${Object.keys(res.report.extracted_data || {}).length} 项指标`, icon: 'none', duration: 2000 })
        this.loadReports()
        // 跳转到详情页
        wx.navigateTo({
          url: `/pages/reports/detail/index?id=${res.report.id}`,
        })
      } else {
        wx.showToast({ title: res?.error || '识别失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '识别失败', icon: 'none' })
    }
    this.setData({ uploading: false })
  },

  onReportTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/reports/detail/index?id=${id}` })
  },

  onDeleteTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除报告',
      content: '确定要删除这份检查报告吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({ url: '/health-reports/delete/', method: 'POST', data: { id } })
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadReports()
          } catch (err) {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      },
    })
  },
})
