// pages/reports/detail/index.js — 检查报告详情
const { request } = require('../../../utils/request')

Page({
  data: {
    report: null,
    loading: true,
    indicators: [],
  },

  onLoad(options) {
    const id = options.id
    if (id) {
      this.loadReport(id)
    }
  },

  async loadReport(id) {
    this.setData({ loading: true })
    try {
      const res = await request({ url: '/health-reports/', method: 'GET' })
      if (res && res.success) {
        const report = res.data.find(r => String(r.id) === String(id))
        if (report) {
          const indicators = this._buildIndicators(report.extracted_data || {})
          this.setData({ report, indicators })
        }
      }
    } catch (_) {}
    this.setData({ loading: false })
  },

  _buildIndicators(data) {
    const labelMap = {
      creatinine: '血肌酐', egfr: '估算肾小球滤过率',
      potassium: '血钾', phosphorus: '血磷', sodium: '血钠',
      hemoglobin: '血红蛋白', albumin: '白蛋白',
      bun: '血尿素氮', calcium: '血钙', uric_acid: '尿酸',
    }
    const evalColors = { '正常': '#52C41A', '偏高': '#FF4D4F', '偏低': '#FAAD14' }
    return Object.entries(data).map(([key, val]) => ({
      key,
      label: labelMap[key] || key,
      value: val.value,
      unit: val.unit || '',
      refRange: val.ref_range || '-',
      eval: val.eval || '-',
      evalColor: evalColors[val.eval] || '#7F8C8D',
    }))
  },

  onDelete() {
    const id = this.data.report?.id
    if (!id) return
    wx.showModal({
      title: '删除报告',
      content: '确定删除这份检查报告吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({ url: '/health-reports/delete/', method: 'POST', data: { id } })
            wx.showToast({ title: '已删除', icon: 'success' })
            wx.navigateBack()
          } catch (_) {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      },
    })
  },
})
