// utils/request.js - 统一网络请求封装
// ★ 不再依赖 getApp()，直接使用硬编码的 apiBaseUrl
// （原因：getApp() 在 onLaunch / _startApp 执行期间可能返回 undefined）

const API_BASE_URL = 'http://127.0.0.1:8000/ckd2/api';
// const API_BASE_URL = 'http://10.63.10.123:8000/ckd2/api';

// 防止重复登录的标记
let isRefreshingToken = false;

const request = (options) => {
  return new Promise((resolve, reject) => {
    // 自动注入 Authorization token（从本地 storage 直接读取）
    const token = wx.getStorageSync('auth_token') || '';
    wx.showNavigationBarLoading();
    wx.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data ?? undefined,
      timeout: 300000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.header,
      },
      success: async (res) => {
        wx.hideNavigationBarLoading();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          if (res.statusCode === 401 || res.statusCode === 403) {
            wx.removeStorageSync('auth_token');
            // 尝试自动重新登录
            if (!isRefreshingToken) {
              isRefreshingToken = true;
              try {
                const app = getApp();
                if (app && app._autoLogin) {
                  console.log('[Request] Token失效，尝试自动重新登录...');
                  await app._autoLogin();
                  wx.showToast({ title: '已重新登录', icon: 'success' });
                  // 重新发送请求
                  const newToken = wx.getStorageSync('auth_token') || '';
                  if (newToken) {
                    // 重新发送原来的请求
                    wx.request({
                      url: `${API_BASE_URL}${options.url}`,
                      method: options.method || 'GET',
                      data: options.data ?? undefined,
                      timeout: 300000,
                      header: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${newToken}`,
                        ...options.header,
                      },
                      success: (retryRes) => {
                        if (retryRes.statusCode >= 200 && retryRes.statusCode < 300) {
                          resolve(retryRes.data);
                        } else {
                          reject({
                            code: retryRes.statusCode,
                            message: retryRes.data?.error || retryRes.data?.message || retryRes.data?.detail || '请求失败',
                            data: retryRes.data || null,
                          });
                        }
                      },
                      fail: (retryErr) => {
                        reject({ code: -1, message: '网络错误，请检查网络连接', detail: retryErr });
                      },
                    });
                    return;
                  }
                }
              } catch (err) {
                console.error('[Request] 自动重新登录失败:', err);
              } finally {
                isRefreshingToken = false;
              }
            }
          }
          reject({
            code: res.statusCode,
            message: res.data?.error || res.data?.message || res.data?.detail || '请求失败',
            data: res.data || null,
          });
        }
      },
      fail: (err) => {
        wx.hideNavigationBarLoading();
        reject({ code: -1, message: '网络错误，请检查网络连接', detail: err });
      },
    });
  });
};

module.exports = { request };
