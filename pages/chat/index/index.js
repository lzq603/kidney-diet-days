// pages/chat/index/index.js
// 肾友饮食 AI 问答页面 — WebSocket 两阶段流式版
const app = getApp()
const { getCurrentStage } = require('../../../utils/storage')

// ─── 配置 ───────────────────────────────────────────────
const WS_BASE = 'ws://127.0.0.1:8000'
// const WS_BASE = 'ws://10.63.10.123:8000'
const WS_URL  = `${WS_BASE}/ws/chat/`
const RECONNECT_DELAYS = [2000, 3000, 5000, 8000, 15000]  // 递增重连间隔（指数退避）

// 欢迎消息（首次打开展示）
const WELCOME_MSG = {
  role: 'assistant',
  text: '👋 你好！我是小光，你的专属肾友营养顾问。\n有任何关于肾友饮食的问题都可以问我～',
  cards: [
    {
      type: 'suggest_questions',
      data: {
        questions: [
          '我是 CKD 3期，西兰花可以吃吗？',
          '高钾食物有哪些需要注意？',
          '肾友每天能吃多少蛋白质？',
        ],
      },
    },
  ],
  done: true,
}

Page({
  data: {
    // 消息列表结构：
    // {
    //   role: 'user' | 'assistant',
    //   text: string,       // 最终文字（user 消息 或 assistant 流式结束后）
    //   streamText: string, // 流式阶段实时拼接的文字（仅 assistant + 未完成时）
    //   cards: [],          // 卡片列表（第二阶段逐张追加）
    //   done: bool,         // 是否完全结束
    // }
    messages: [],
    inputText: '',
    isConnected: false,
    isStreaming: false,
    ckdStage: '3a',
    scrollIntoView: '',
    reconnecting: false,  // 是否正在重连
    // 配额相关（对话独立3次，图片/文字分析共享3次）
    chatRemaining: -1,  // -1 表示未加载，>=0 为实际值（VIP 显示 9999）
    isVip: false,
    showQuotaTip: false,
  },

  _reconnectAttempts: 0,  // 重连计数

  onLoad() {
    // ★ 从服务端缓存读取 CKD 分期
    const currentStage = app.globalData.currentStage || getCurrentStage() || '3a'
    this.setData({
      ckdStage: currentStage,
      messages: [WELCOME_MSG],
    })
    this._connectWS()
    this._loadQuota()
  },

  onUnload() {
    this._closeWS()
  },

  onHide() {
    // 页面隐藏时不停 WebSocket，保持连接
  },

  onShow() {
    // 每次切回聊天页时刷新 CKD 分期和配额（用户可能在 VIP 页开通了会员）
    const currentStage = app.globalData.currentStage || getCurrentStage() || '3a'
    if (currentStage !== this.data.ckdStage) {
      this.setData({ ckdStage: currentStage })
    }
    this._loadQuota()
  },

  // ─── WebSocket ───────────────────────────────────────
  _connectWS() {
    if (this._ws) { try { this._ws.close() } catch (_) {} }

    // 在 URL query 参数中携带 token，后端 consumer 从中解析 openid
    const token = wx.getStorageSync('auth_token') || '';
    const wsUrl = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;

    this._ws = wx.connectSocket({
      url: wsUrl,
      header: { 'content-type': 'application/json' },
      fail: () => {
        wx.showToast({ title: '服务连接失败', icon: 'none' })
        this._scheduleReconnect()
      },
    })

    this._ws.onOpen(() => {
      this._reconnectAttempts = 0
      this.setData({ isConnected: true, reconnecting: false, isStreaming: false })
      this._startPing()
    })

    this._ws.onMessage((res) => this._onMessage(res.data))

    this._ws.onClose((res) => {
      console.warn('[WS] 连接关闭, code:', res.code, 'reason:', res.reason)
      this.setData({ isConnected: false, isStreaming: false })
      this._stopPing()
      // 非主动关闭才重连
      if (!this._intentionalClose) {
        this._scheduleReconnect()
      }
      this._intentionalClose = false
    })

    this._ws.onError((err) => {
      console.error('[WS] 连接错误:', err)
      this.setData({ isConnected: false, isStreaming: false })
    })
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
    console.log(`[WS] ${delay}ms 后重连 (第${this._reconnectAttempts}次)`)
    this._reconnectTimer = setTimeout(() => {
      if (!this._intentionalClose) {
        this._connectWS()
      }
    }, delay)
  },

  _startPing() {
    this._stopPing()
    this._pingTimer = setInterval(() => {
      if (this._ws && this.data.isConnected) {
        try { this._ws.send({ data: JSON.stringify({ type: 'ping' }) }) } catch (_) {}
      }
    }, 15000)  // 15秒 ping 一次（之前 25 秒太长，容易触发服务端/代理超时）
  },
  _stopPing() { clearInterval(this._pingTimer) },

  // ─── 消息处理 ─────────────────────────────────────────
  _onMessage(rawData) {
    console.log('[WS] 收到原始数据:', rawData)
    let msg
    try { msg = JSON.parse(rawData) } catch (e) {
      console.error('[WS] 解析失败:', e)
      return
    }

    console.log('[WS] 解析后的消息:', msg)

    switch (msg.type) {
      case 'pong': return

      case 'token':
        // 第一阶段：流式文字，追加到 streamText
        this._appendToken(msg.content)
        break

      case 'card':
        // 第二阶段：卡片到来，追加到 cards（文字已在 streamText 中显示，不受影响）
        this._appendCard(msg.card)
        break

      case 'done':
        // 全部结束：把 streamText 固化为 text，清空 streamText（移除光标）
        this._finalize()
        break

      case 'error':
        this._onError(msg.message, msg)
        break
    }
  },

  _appendToken(token) {
    console.log('[WS] 追加 token:', token)
    const msgs = [...this.data.messages]
    const last  = msgs[msgs.length - 1]
    if (last && last.role === 'assistant' && !last.done) {
      last.streamText = (last.streamText || '') + token
      console.log('[WS] 更新后的流文字:', last.streamText)
      this.setData({ messages: msgs })
      this._scrollToBottom()
    } else {
      console.warn('[WS] 找不到可以追加的 AI 消息')
    }
  },

  _appendCard(card) {
    const msgs = [...this.data.messages]
    const last  = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      last.cards = [...(last.cards || []), card]
      this.setData({ messages: msgs })
      this._scrollToBottom()
    }
  },

  _finalize() {
    const msgs = [...this.data.messages]
    const last  = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      // streamText → text，清除流式状态（光标消失）
      last.text       = last.streamText || ''
      last.streamText = ''
      last.done       = true
    }
    this.setData({ messages: msgs, isStreaming: false })
    this._scrollToBottom()
  },

  _onError(errMsg, extra) {
    const isTokenInvalid = extra && extra.error_code === 'TOKEN_INVALID'

    if (isTokenInvalid) {
      console.warn('[WS] Token过期，静默处理')
      this.setData({ isStreaming: false })
      return
    }

    const msgs = [...this.data.messages]
    const last  = msgs[msgs.length - 1]
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
        last.text       = last.streamText || '抱歉，出了点问题，请再试一次。'
        last.streamText = ''
        last.done       = true
        last.cards      = [{
          type: 'suggest_questions',
          data: { questions: ['换个问题问问', '有哪些食材适合肾友？'] },
        }]
      }
    }
    this.setData({ messages: msgs, isStreaming: false })
  },
  onInputChange(e) {
    this.setData({ inputText: e.detail.value })
  },

  onSendTap() {
    const text = this.data.inputText.trim()
    console.log('[Chat] onSendTap 被触发:', {
      原始输入: this.data.inputText,
      去除空格后: text,
      正在流: this.data.isStreaming,
      连接状态: this.data.isConnected
    })
    if (!text) {
      console.warn('[Chat] 空消息，不发送')
      return
    }
    if (this.data.isStreaming) {
      console.warn('[Chat] 正在接收回复中，不发送')
      return
    }
    this._sendMessage(text)
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

  _buildHistory() {
    const history = []
    for (const m of this.data.messages) {
      if (!m.done) continue
      if (m.role === 'user') {
        history.push({ role: 'user', content: m.text })
      } else if (m.role === 'assistant' && m.text) {
        history.push({ role: 'assistant', content: m.text })
      }
    }
    return history.slice(-10)
  },

  _sendMessage(text) {
    const callStack = new Error().stack
    console.log('[Chat] _sendMessage 被调用:', {
      消息: text,
      调用栈: callStack
    })

    if (!this.data.isConnected) {
      wx.showToast({ title: '正在重连，请稍候', icon: 'none' })
      this._connectWS()
      return
    }

    // ── 本地配额预检（对话独立：非 VIP 且对话剩余次数 ≤ 0 时拦截）──
    if (!this.data.isVip && this.data.chatRemaining !== -1 && this.data.chatRemaining <= 0) {
      this.setData({ showQuotaTip: true, chatRemaining: 0 })
      const msgs = [
        ...this.data.messages,
        { role: 'user', text, cards: [], done: true },
        { role: 'assistant', text: '🔒 今日 AI 对话次数已用完（3次/天）\n\n开通会员可无限次使用，仅 ¥9.9/月', streamText: '', done: true, cards: [{
          type: 'warning_card',
          data: { title: '今日对话次数已用完', content: '开通会员可无限次使用 AI 对话，仅 ¥9.9/月' },
        }, {
          type: 'suggest_questions',
          data: { questions: ['🌿 加入会员解锁无限次', '了解会员权益'] },
        }] },
      ]
      this.setData({ messages: msgs })
      this._scrollToBottom()
      return
    }

    const msgs = [
      ...this.data.messages,
      { role: 'user', text, cards: [], done: true },
      { role: 'assistant', text: '', streamText: '', cards: [], done: false },
    ]
    this.setData({ messages: msgs, inputText: '', isStreaming: true })
    this._scrollToBottom()

    const payload = JSON.stringify({
      type:      'chat',
      message:   text,
      history:   this._buildHistory(),
      ckd_stage: this.data.ckdStage,
      _token:    wx.getStorageSync('auth_token') || '',
    })
    console.log('[Chat] 准备发送 WebSocket 消息:', payload)
    this._ws.send({ data: payload })
  },

  // ─── 加载今日配额（对话独立3次）─────────────────────
  async _loadQuota() {
    try {
      const { request } = require('../../utils/request')
      const res = await request({ url: '/vip/status/', method: 'GET' })
      if (res && res.success) {
        const chatQ = res.quota?.chat || {}
        this.setData({
          isVip: res.vip.isVip,
          chatRemaining: chatQ.remaining !== undefined ? chatQ.remaining : 3,
          showQuotaTip: (!res.vip.isVip && chatQ.remaining !== undefined && chatQ.remaining <= 0),
        })
      }
    } catch (_) {}
  },

  onGoVip() {
    wx.navigateTo({ url: '/pages/vip/index/index' })
  },

  // ─── 点击食谱卡片 ────────────────────────────────────
  onRecipeCardTap(e) {
    const { name } = e.currentTarget.dataset
    if (name) {
      wx.navigateTo({ url: `/pages/recipes/detail/index?dish=${encodeURIComponent(name)}` })
    }
  },

  // ─── 第 1 期肾友卡片：点击 / 快捷指令 ────────────────
  // 📊 点击报告卡 → 跳报告详情
  onReportCardTap(e) {
    const { reportId } = e.currentTarget.dataset
    if (reportId) {
      wx.navigateTo({ url: `/pages/reports/detail/index?id=${reportId}` })
    } else {
      wx.switchTab({ url: '/pages/reports/index/index' }).catch(() => {
        wx.navigateTo({ url: '/pages/reports/index/index' })
      })
    }
  },

  // 🍱 点击今日营养卡 → 跳饮食记录页
  onNutritionTodayTap() {
    wx.navigateTo({ url: '/pages/records/index/index' })
  },

  // ✅ 点击食物安全卡 → 跳食材库详情
  onFoodSafetyTap(e) {
    const { foodId, foodName } = e.currentTarget.dataset
    if (foodId) {
      wx.navigateTo({ url: `/pages/foods/detail/index?id=${foodId}` })
    } else if (foodName) {
      wx.navigateTo({ url: `/pages/foods/detail/index?name=${encodeURIComponent(foodName)}` })
    }
  },

  // 🛒 点击商品卡 → 跳商品详情
  onProductCardTap(e) {
    const { productId } = e.currentTarget.dataset
    if (productId) {
      wx.navigateTo({ url: `/pages/shop/detail/index?id=${productId}` })
    }
  },

  // 💧 喝水快捷加水
  onAddWater(e) {
    const ml = parseInt(e.currentTarget.dataset.ml || 0, 10) || 200
    wx.showToast({ title: `已记录 ${ml}mL（开发中）`, icon: 'success' })
    // TODO: 调用后端 /api/water/add 接口
  },

  // 🚀 快捷指令：把芯片文字塞进输入框直接发送
  onQuickAsk(e) {
    const q = e.currentTarget.dataset.q
    if (!q || this.data.isStreaming) return
    this.setData({ inputText: q })
    this.onSendTap()
  },

  // 📸 拍菜分析（跳转图像分析页）
  onTakePhotoAnalyze() {
    wx.navigateTo({ url: '/pages/photo-analyze/index/index' }).catch(() => {
      wx.showToast({ title: '即将开放', icon: 'none' })
    })
  },

  // ─── 滚动到底部 ──────────────────────────────────────
  _scrollToBottom() {
    this.setData({ scrollIntoView: 'msg-bottom' })
    // 每次设置新值才能触发 scroll-into-view（必须先清再设）
    setTimeout(() => this.setData({ scrollIntoView: '' }), 50)
  },
})
