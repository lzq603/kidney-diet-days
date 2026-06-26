// pages/index/index.js — 极简首页（单输入框 + 全屏 AI 问答）
const app = getApp()
const { getCurrentStage } = require('../../utils/storage')
const { request } = require('../../utils/request')

const WS_BASE = 'ws://127.0.0.1:8000'
// const WS_BASE = 'ws://10.63.10.123:8000'
const WS_URL = `${WS_BASE}/ws/chat/`
const RECONNECT_DELAYS = [2000, 3000, 5000, 8000, 15000]

Page({
  data: {
    nickname: '肾友',
    ckdStage: '3a',
    isVip: false,
    vipDaysLeft: 0,
    chatRemaining: -1,
    showQuotaTip: false,

    inputText: '',
    chatExpanded: false,
    isConnected: false,
    isStreaming: false,
    reconnecting: false,
    scrollIntoView: '',
    messages: [],

    todaySummary: {
      calories: 0,
      protein_g: 0,
      potassium_pct: 0,
      phosphorus_pct: 0,
      water_used: 0,
      water_limit: 1500,
    },

    quickExamples: [
      { text: '今天还能吃什么？', q: '根据我今天已吃的内容和CKD分期，告诉我今天接下来还能吃什么；请直接从菜谱库推荐一道具体菜，并生成可点击查看做法的食谱卡片。' },
      { text: '推荐一道安全菜', q: '推荐一道适合我CKD分期的具体家常菜，给出做法，并生成可点击的食谱卡片。' },
      { text: '看看我的报告', q: '请查看我最近一次检查报告，列出指标，重点指出异常项，告诉饮食上要注意什么。' },
      { text: '什么菜低磷低钾？', q: '给我推荐5道低磷低钾的家常菜，要有具体菜名。' },
    ],

    reportChips: [
      { text: '看我的报告', q: '请读取我最近一次检查报告，重点看肌酐、eGFR、尿素氮、尿酸、血钾、血磷、白蛋白，并告诉我饮食上要注意什么。' },
      { text: '异常指标', q: '请查看我最近的检查报告，列出异常指标，并按严重程度告诉我哪些最需要关注。' },
      { text: '报告趋势', q: '请对比我的历史检查报告，看看肌酐、eGFR、尿酸、血钾、血磷有没有变好或变差。' },
    ],
    dietChips: [
      { text: '今日饮食', q: '请查看我今天的饮食记录，分析热量、蛋白质、钾、磷、钠是否合适。' },
      { text: '还能吃什么', q: '根据我今天已吃的内容和CKD分期，告诉我今天接下来还能吃什么；请直接从菜谱库推荐一道具体菜，并生成可点击查看做法的食谱卡片。' },
      { text: '推荐一餐', q: '请从菜谱库直接推荐一道适合我CKD分期的具体菜谱，并生成可点击查看做法的食谱卡片，不要只展示今日摄入卡。' },
    ],
    foodChips: [
      { text: '查食物', q: '香蕉肾友能吃吗？请结合钾、磷、蛋白质和食用量说明。' },
      { text: '控钾建议', q: '我想控制血钾，今天饮食里有哪些高钾风险？应该怎么调整？' },
      { text: '控磷建议', q: '我想控制血磷，今天饮食里有哪些高磷风险？应该怎么调整？' },
    ],
  },

  _reconnectAttempts: 0,
  _intentionalClose: false,

  async onLoad() {
    await this._ensureAppStarted()
    const stage = app.globalData.currentStage || getCurrentStage()
    if (!stage) {
      wx.redirectTo({ url: '/pages/onboard/index' })
      return
    }
    this.setData({ ckdStage: stage })
    this._loadProfile()
    this._loadQuota()
    this._connectWS()
  },

  async _ensureAppStarted() {
    if (app.globalData._startPromise) {
      try { await app.globalData._startPromise } catch (_) {}
    }
    if (!wx.getStorageSync('auth_token') && app._autoLogin) {
      app.globalData._startPromise = app._autoLogin()
      try { await app.globalData._startPromise } catch (_) {}
    }
  },

  onShow() {
    const stage = app.globalData.currentStage || getCurrentStage()
    if (stage && stage !== this.data.ckdStage) this.setData({ ckdStage: stage })
    this._loadQuota()
  },

  onUnload() {
    this._closeWS()
  },

  async _loadProfile() {
    try {
      const res = await request({ url: '/user/profile/', method: 'GET' })
      if (res && res.success && res.data) {
        this.setData({ nickname: res.data.nickname || '肾友' })
      }
    } catch (_) {}
  },

  async _loadQuota() {
    try {
      const res = await request({ url: '/vip/status/', method: 'GET' })
      if (res && res.success) {
        const chatQ = res.quota?.chat || {}
        this.setData({
          isVip: res.vip.isVip,
          vipDaysLeft: res.vip.vipDaysLeft || 0,
          chatRemaining: chatQ.remaining !== undefined ? chatQ.remaining : 3,
          showQuotaTip: (!res.vip.isVip && chatQ.remaining !== undefined && chatQ.remaining <= 0),
        })
      }
    } catch (_) {}
  },

  async _loadTodaySummary() {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await request({ url: `/diet/list/?date=${today}`, method: 'GET' })
      if (res && res.success && Array.isArray(res.records)) {
        let calories = 0, protein = 0, k = 0, p = 0, water = 0
        for (const r of res.records) {
          const n = r.nutrition || {}
          calories += parseFloat(n.calories || 0) || 0
          protein += parseFloat(n.protein || n.protein_g || 0) || 0
          k += parseFloat(n.potassium || 0) || 0
          p += parseFloat(n.phosphorus || 0) || 0
          water += parseFloat(r.water_ml || r.water || 0) || 0
        }
        const stageLimit = {
          '1': {k: 4000, p: 1000}, '2': {k: 3500, p: 1000},
          '3a': {k: 3000, p: 900}, '3b': {k: 2500, p: 800},
          '4': {k: 2000, p: 700}, '5': {k: 1500, p: 600},
          'dialysis': {k: 2000, p: 800},
        }
        const limit = stageLimit[this.data.ckdStage] || stageLimit['3a']
        this.setData({
          'todaySummary.calories': Math.round(calories),
          'todaySummary.protein_g': Math.round(protein * 10) / 10,
          'todaySummary.potassium_pct': Math.min(100, Math.round(k / limit.k * 100)),
          'todaySummary.phosphorus_pct': Math.min(100, Math.round(p / limit.p * 100)),
          'todaySummary.water_used': Math.round(water),
        })
      }
    } catch (_) {}
  },

  // ─── WebSocket ───────────────────────────────────────
  _connectWS() {
    if (this._ws) { try { this._ws.close() } catch (_) {} }
    this._intentionalClose = false
    const token = wx.getStorageSync('auth_token') || ''
    if (!token) {
      this.setData({ isConnected: false, reconnecting: false })
      console.warn('[Home] WebSocket 未连接：缺少 auth_token')
      return
    }
    const wsUrl = `${WS_URL}?token=${encodeURIComponent(token)}`
    this._ws = wx.connectSocket({ url: wsUrl, header: { 'content-type': 'application/json' } })
    this._ws.onOpen(() => {
      this._reconnectAttempts = 0
      this.setData({ isConnected: true, reconnecting: false })
      this._startPing()
    })
    this._ws.onMessage((res) => this._onMessage(res.data))
    this._ws.onClose(() => {
      this.setData({ isConnected: false, isStreaming: false })
      this._stopPing()
      if (!this._intentionalClose) this._scheduleReconnect()
      this._intentionalClose = false
    })
    this._ws.onError(() => this.setData({ isConnected: false, isStreaming: false }))
  },

  _closeWS() {
    this._stopPing()
    clearTimeout(this._reconnectTimer)
    this._intentionalClose = true
    if (this._ws) { try { this._ws.close() } catch (_) {} this._ws = null }
  },

  _scheduleReconnect() {
    if (this._intentionalClose) return
    const delay = RECONNECT_DELAYS[Math.min(this._reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this._reconnectAttempts++
    this.setData({ reconnecting: true })
    this._reconnectTimer = setTimeout(() => { if (!this._intentionalClose) this._connectWS() }, delay)
  },

  _startPing() {
    this._stopPing()
    this._pingTimer = setInterval(() => {
      if (this._ws && this.data.isConnected) {
        try { this._ws.send({ data: JSON.stringify({ type: 'ping' }) }) } catch (_) {}
      }
    }, 15000)
  },
  _stopPing() { clearInterval(this._pingTimer) },

  _onMessage(rawData) {
    let msg
    try { msg = JSON.parse(rawData) } catch (_) { return }
    switch (msg.type) {
      case 'pong': return
      case 'ping':
        // 响应服务端的ping
        try { this._ws.send({ data: JSON.stringify({ type: 'pong' }) }) } catch (_) {}
        return
      case 'token': this._appendToken(msg.content); break
      case 'card': this._appendCard(msg.card); break
      case 'done': this._finalize(); break
      case 'error':
        // 检查是否是token过期错误
        if (msg.error_code === 'TOKEN_INVALID' || msg.message.includes('登录已过期') || msg.message.includes('重新登录')) {
          console.warn('[Home] Token已过期，尝试重新登录...')
          this._handleTokenExpired()
          return
        }
        this._onError(msg.message, msg); break
    }
  },

  async _handleTokenExpired() {
    // 关闭当前连接
    this._closeWS()
    try {
      // 触发app.js的自动登录
      const app = getApp()
      if (app._autoLogin) {
        console.log('[Home] 触发自动重新登录...')
        await app._autoLogin()
        // 重新连接
        this._connectWS()
        wx.showToast({ title: '已重新登录', icon: 'success' })
      } else {
        wx.showToast({ title: '请重新登录', icon: 'none' })
      }
    } catch (err) {
      console.error('[Home] 重新登录失败:', err)
      wx.showToast({ title: '请重新登录', icon: 'none' })
    }
  },

  _appendToken(token) {
    const msgs = [...this.data.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant' && !last.done) {
      last.streamText = (last.streamText || '') + token
      this.setData({ messages: msgs })
      this._scrollToBottom()
    }
  },

  _appendCard(card) {
    const msgs = [...this.data.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      last.cards = [...(last.cards || []), card]
      this.setData({ messages: msgs })
      this._scrollToBottom()
    }
  },

  _finalize() {
    const msgs = [...this.data.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      last.text = last.streamText || ''
      last.streamText = ''
      last.done = true
    }
    this.setData({ messages: msgs, isStreaming: false })
    this._scrollToBottom()
  },

  _onError(errMsg, extra) {
    const msgs = [...this.data.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      const isQuotaLimit = extra && extra.is_quota_limit
      if (isQuotaLimit) {
        this.setData({ showQuotaTip: true, chatRemaining: 0 })
        last.text = errMsg || '今日 AI 对话次数已用完'
        last.streamText = ''
        last.done = true
        last.cards = [{
          type: 'warning_card',
          data: { title: '🔒 今日对话次数已用完', content: '开通会员可无限次使用 AI 对话，仅 ¥9.9/月' },
        }, {
          type: 'suggest_questions',
          data: { questions: ['🌿 加入会员解锁无限次', '了解会员权益'] },
        }]
      } else {
        last.text = errMsg || last.streamText || '抱歉，出了点问题，请再试一次。'
        last.streamText = ''
        last.done = true
        last.cards = [{
          type: 'suggest_questions',
          data: { questions: ['换个问题问问', '有哪些食材适合肾友？'] },
        }]
      }
    }
    this.setData({ messages: msgs, isStreaming: false })
  },

  onGoProfile() { wx.switchTab({ url: '/pages/profile/index/index' }) },

  onInputChange(e) { this.setData({ inputText: e.detail.value }) },

  onFocusChatInput() {
    // 模仿 DeepSeek：聚焦/输入时首页位置不变，发送后才进入全屏对话。
  },

  onCollapseChat() { this.setData({ chatExpanded: false }) },

  onClearChat() {
    this.setData({ messages: [], inputText: '' })
  },

  onSendTap() {
    const text = (this.data.inputText || '').trim()
    if (!text || this.data.isStreaming) return
    this._sendMessage(text)
  },

  onChipTap(e) {
    const q = e.currentTarget.dataset.q || ''
    if (!q || this.data.isStreaming) return
    this.setData({ inputText: q, chatExpanded: true })
    this._sendMessage(q)
  },

  _buildHistory() {
    const history = []
    for (const m of this.data.messages) {
      if (!m.done) continue
      if (m.role === 'user') history.push({ role: 'user', content: m.text })
      else if (m.role === 'assistant' && m.text) history.push({ role: 'assistant', content: m.text })
    }
    return history.slice(-8)
  },

  async _sendMessage(text) {
    if (!this.data.isConnected) {
      await this._ensureAppStarted()
      this._connectWS()
      wx.showToast({ title: '正在连接，请稍候', icon: 'none' })
      return
    }

    // ── 本地配额预检（非 VIP 且对话剩余次数 ≤ 0 时拦截）──
    if (!this.data.isVip && this.data.chatRemaining !== -1 && this.data.chatRemaining <= 0) {
      this.setData({ showQuotaTip: true, chatRemaining: 0 })
      const msgs = [
        ...this.data.messages,
        { role: 'user', text, cards: [], done: true },
        { role: 'assistant', text: '🔒 今日 AI 对话次数已用完（3次/天）\n\n开通会员可无限使用，仅 ¥9.9/月', streamText: '', done: true, cards: [{
          type: 'warning_card',
          data: { title: '今日对话次数已用完', content: '开通会员可无限次使用 AI 对话，仅 ¥9.9/月' },
        }, {
          type: 'suggest_questions',
          data: { questions: ['🌿 加入会员解锁无限次', '了解会员权益'] },
        }] },
      ]
      this.setData({ messages: msgs, chatExpanded: true })
      this._scrollToBottom()
      return
    }

    const msgs = [
      ...this.data.messages,
      { role: 'user', text, cards: [], done: true },
      { role: 'assistant', text: '', streamText: '', cards: [], done: false },
    ]
    this.setData({ messages: msgs, inputText: '', isStreaming: true, chatExpanded: true })
    this._scrollToBottom()
    this._ws.send({
      data: JSON.stringify({
        type: 'chat',
        message: text,
        history: this._buildHistory(),
        ckd_stage: this.data.ckdStage,
      }),
    })
  },

  onSuggestTap(e) {
    const q = e.currentTarget.dataset.question
    if (!q || this.data.isStreaming) return
    // 会员引导类问题 → 跳转 VIP 页
    if (q.includes('加入会员') || q.includes('会员权益')) {
      wx.navigateTo({ url: '/pages/vip/index/index' })
      return
    }
    this._sendMessage(q)
  },

  onRecipeCardTap(e) {
    const { name } = e.currentTarget.dataset
    if (name) {
      wx.navigateTo({ url: `/pages/recipes/detail/index?dish=${encodeURIComponent(name)}&fromCache=1` })
    }
  },

  onReportCardTap(e) {
    const { reportId } = e.currentTarget.dataset
    if (reportId) wx.navigateTo({ url: `/pages/reports/detail/index?id=${reportId}` })
    else wx.navigateTo({ url: '/pages/reports/index/index' })
  },

  onNutritionTodayTap() { wx.navigateTo({ url: '/pages/records/index/index' }) },

  onFoodSafetyTap(e) {
    const { foodId, foodName } = e.currentTarget.dataset
    if (foodId) wx.navigateTo({ url: `/pages/foods/detail/index?id=${foodId}` })
    else if (foodName) wx.navigateTo({ url: `/pages/foods/detail/index?name=${encodeURIComponent(foodName)}` })
  },

  onProductCardTap(e) {
    const { productId } = e.currentTarget.dataset
    if (productId) wx.navigateTo({ url: `/pages/shop/detail/index?id=${productId}` })
  },

  _scrollToBottom() {
    this.setData({ scrollIntoView: 'home-msg-bottom' })
    setTimeout(() => this.setData({ scrollIntoView: '' }), 50)
  },

  onGoReports() { wx.navigateTo({ url: '/pages/reports/index/index' }) },
  onGoRecords() { wx.navigateTo({ url: '/pages/records/index/index' }) },
  onGoFoods() { wx.navigateTo({ url: '/pages/foods/index/index' }) },
  onGoRecipes() { wx.switchTab({ url: '/pages/recipes/index/index' }) },
  onGoVip() { wx.navigateTo({ url: '/pages/vip/index/index' }) },

  // 分享给朋友
  onShareAppMessage() {
    return {
      title: '肾友食光 - 专为肾病患者设计的饮食管理助手',
      path: '/pages/index/index',
      imageUrl: '/images/share-cover.jpg',
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '肾友食光 - 专为肾病患者设计的饮食管理助手',
      imageUrl: '/images/share-cover.jpg',
    }
  },
})
