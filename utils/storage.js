// utils/storage.js - 服务端优先的数据管理模块
//
// 改造原则：
//   1. 所有业务数据（饮食记录、收藏、用户信息、CKD分期）以服务端为准
//   2. 本地 Storage 仅保留 auth_token（登录令牌）
//   3. 内存缓存（module 级变量）用于减少重复请求，页面 onShow 时可刷新
//   4. 写操作直接调 API，成功后更新内存缓存
const { request } = require('./request');

// ─── 内存缓存（应用生命周期内有效）──────────────
let _cache = {
  profile: null,          // { nickname, ckd_stage, avatar, ... }
  dietRecords: null,      // { "2025-04-30": [record, ...], ... }  或 null=未加载
  favorites: null,        // [recipe, ...]  或 null=未加载
  _profileLoaded: false,
  _recordsLoaded: false,
  _favoritesLoaded: false,
};

// ─── 工具函数 ──────────────────────────────────────

/**
 * 获取近7天日期列表
 */
const getLast7Days = () => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(formatDate(d));
  }
  return days;
};

/**
 * 格式化日期 → YYYY-MM-DD
 */
const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ─── 用户资料 / CKD 分期（服务端 API）──────────────

/**
 * 获取用户资料（从内存缓存或服务端）
 * @param {boolean} forceRefresh - 是否强制重新拉取
 */
const getProfile = async (forceRefresh = false) => {
  if (_cache.profile && !forceRefresh) return _cache.profile;
  try {
    const res = await request({ url: '/user/profile/', method: 'GET' });
    if (res && res.data) {
      _cache.profile = res.data;
      _cache._profileLoaded = true;
      return res.data;
    }
  } catch (err) {
    console.warn('[Storage] 获取用户资料失败:', err);
  }
  return _cache.profile || { nickname: '', ckd_stage: '' };
};

/** 同步版本：直接返回缓存（可能为null） */
const getProfileSync = () => _cache.profile;

/**
 * 获取当前 CKD 分期（兼容旧接口）
 */
const getCurrentStage = () => {
  return (_cache.profile && _cache.profile.ckd_stage) || '';
};

/**
 * 获取用户昵称
 */
const getNickname = () => {
  return (_cache.profile && _cache.profile.nickname) || '肾友';
};

/**
 * 保存用户设置到后端（昵称 + 分期 + 身体数据）
 */
const saveProfileToServer = ({ nickname, ckdStage, ckdType, gender, height_cm, weight_kg, birth_year }) => {
  const data = { nickname, ckd_stage: ckdStage };
  if (ckdType !== undefined) data.ckd_type = ckdType;
  if (gender !== undefined) data.gender = gender;
  if (height_cm !== null) data.height_cm = height_cm;
  if (weight_kg !== null) data.weight_kg = weight_kg;
  if (birth_year !== null) data.birth_year = birth_year;
  return request({
    url: '/user/profile/',
    method: 'POST',
    data,
  }).then(res => {
    // 成功后立即更新缓存
    if (res && res.data) {
      _cache.profile = { ..._cache.profile, ...res.data };
    }
    return res;
  }).catch(err => {
    console.warn('[Storage] 保存用户资料失败:', err);
    throw err;
  });
};

// ─── 饮食记录（服务端 API）────────────────────────

/**
 * 获取饮食记录（全部，按日期分组）
 * @param {boolean} forceRefresh - 强制刷新
 * @returns {Promise<Object>} { "YYYY-MM-DD": [record,...] }
 */
const fetchDietRecords = async (forceRefresh = false) => {
  if (_cache.dietRecords && !forceRefresh) return _cache.dietRecords;
  try {
    const res = await request({ url: '/user/records/', method: 'GET' });
    if (res && res.data) {
      _cache.dietRecords = res.data;
      _cache._recordsLoaded = true;
      return res.data;
    }
  } catch (err) {
    console.warn('[Storage] 获取饮食记录失败:', err);
  }
  return _cache.dietRecords || {};
};

/**
 * 获取指定日期的饮食记录（同步，从内存缓存读）
 * @param {string} dateStr - YYYY-MM-DD
 */
const getDietRecords = (dateStr) => {
  const records = _cache.dietRecords || {};
  if (dateStr) {
    return records[dateStr] || [];
  }
  return records;
};

/**
 * 添加饮食记录（写后端 → 更新缓存）
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Object} record - 记录数据
 * @returns {Promise<Object>} 后端返回的记录（含 serverId）
 */
const addDietRecord = async (dateStr, record) => {
  // 1. 调用后端 API
  const res = await request({
    url: '/user/records/add/',
    method: 'POST',
    data: {
      date: dateStr,
      name: record.name,
      safeLevel: record.safeLevel,
      mealType: record.mealType,
      portionGrams: record.portionGrams,
      score: record.score,
      nutrition: record.nutrition || {},
    },
  });

  // 2. 成功后更新内存缓存。必须拿到后端确认，不做本地假记录兜底。
  const serverId = res && (res.id || res.serverId || (res.data && res.data.id));
  if (res && res.success && serverId) {
    const serverRecord = {
      ...record,
      id: serverId,
      serverId,
      createTime: new Date().toISOString(),
    };
    if (!_cache.dietRecords) _cache.dietRecords = {};
    if (!_cache.dietRecords[dateStr]) _cache.dietRecords[dateStr] = [];
    _cache.dietRecords[dateStr].unshift(serverRecord);
    return serverRecord;
  }

  throw new Error('[Storage] 添加饮食记录未得到服务器确认');
};

/**
 * 删除饮食记录（写后端 → 更新缓存）
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} recordId - 记录 ID（serverId 或本地 id）
 */
const deleteDietRecord = async (dateStr, recordId) => {
  // 1. 先找要删的记录
  const dayRecords = (_cache.dietRecords && _cache.dietRecords[dateStr]) || [];
  const target = dayRecords.find(r =>
    r.id === recordId || r.serverId === recordId || String(r.id) === String(recordId)
  );
  const serverId = target ? (target.serverId || target.id) : recordId;

  // 2. 调用后端删除
  try {
    await request({
      url: '/user/records/delete/',
      method: 'POST',
      data: { id: serverId },
    });
  } catch (err) {
    console.warn('[Storage] 后端删除记录失败:', err);
    throw err;
  }

  // 3. 更新内存缓存
  if (_cache.dietRecords && _cache.dietRecords[dateStr]) {
    _cache.dietRecords[dateStr] = _cache.dietRecords[dateStr].filter(
      r => r.id !== recordId && r.serverId !== recordId && String(r.id) !== String(recordId)
    );
  }
};

/**
 * 更新饮食记录（写后端 → 更新缓存）
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} recordId - 记录 ID（serverId 或本地 id）
 * @param {Object} updateData - 更新数据
 * @returns {Promise<Object>} 更新后的记录
 */
const updateDietRecord = async (dateStr, recordId, updateData) => {
  // 1. 先找要更新的记录
  const dayRecords = (_cache.dietRecords && _cache.dietRecords[dateStr]) || [];
  const target = dayRecords.find(r =>
    r.id === recordId || r.serverId === recordId || String(r.id) === String(recordId)
  );
  const serverId = target ? (target.serverId || target.id) : recordId;

  // 2. 调用后端更新
  const res = await request({
    url: '/user/records/update/',
    method: 'POST',
    data: {
      id: serverId,
      ...updateData,
    },
  });

  // 3. 成功后更新内存缓存
  if (res && res.success) {
    if (_cache.dietRecords && _cache.dietRecords[dateStr]) {
      const index = _cache.dietRecords[dateStr].findIndex(r =>
        r.id === recordId || r.serverId === recordId || String(r.id) === String(recordId)
      );
      if (index !== -1) {
        _cache.dietRecords[dateStr][index] = {
          ..._cache.dietRecords[dateStr][index],
          ...updateData,
        };
      }
    }
    return res.data || res;
  }

  throw new Error('[Storage] 更新饮食记录未得到服务器确认');
};

// ─── 收藏食谱（服务端 API）────────────────────────

/**
 * 获取收藏食谱列表
 * @param {boolean} forceRefresh
 * @returns {Promise<Array>}
 */
const fetchFavorites = async (forceRefresh = false) => {
  if (_cache.favorites && !forceRefresh) return _cache.favorites;
  try {
    const res = await request({ url: '/user/favorites/', method: 'GET' });
    if (res && Array.isArray(res.data)) {
      _cache.favorites = res.data.map(f => ({
        id: f.id,
        name: f.name,
        safeLevel: f.safeLevel,
        reason: f.reason,
        nutrition: f.nutrition,
        score: f.score,
        favoriteTime: f.favoriteTime,
      }));
      _cache._favoritesLoaded = true;
      return _cache.favorites;
    }
  } catch (err) {
    console.warn('[Storage] 获取收藏列表失败:', err);
  }
  return _cache.favorites || [];
};

/** 同步版本（从内存缓存读） */
const getFavoriteRecipes = () => {
  return _cache.favorites || [];
};

/**
 * 收藏/取消收藏（写后端 → 更新缓存）
 * @param {Object} recipe - 食谱对象
 * @returns {Promise<boolean>} true=已收藏, false=已取消
 */
const toggleFavoriteRecipe = async (recipe) => {
  const isCurrentlyFav = _cache.favorites &&
    _cache.favorites.some(r => r.name === recipe.name);

  if (isCurrentlyFav) {
    // 取消收藏
    await request({
      url: '/user/favorites/toggle/',
      method: 'POST',
      data: { name: recipe.name },
    });
    if (_cache.favorites) {
      _cache.favorites = _cache.favorites.filter(r => r.name !== recipe.name);
    }
    return false;
  } else {
    // 添加收藏
    await request({
      url: '/user/favorites/toggle/',
      method: 'POST',
      data: {
        name: recipe.name,
        safeLevel: recipe.safeLevel,
        reason: recipe.reason || '',
        nutrition: recipe.nutrition || {},
        score: recipe.score || 50,
      },
    });
    const newFav = {
      name: recipe.name,
      safeLevel: recipe.safeLevel,
      reason: recipe.reason || '',
      nutrition: recipe.nutrition || {},
      score: recipe.score || 50,
      favoriteTime: new Date().toISOString(),
    };
    if (!_cache.favorites) _cache.favorites = [];
    _cache.favorites.unshift(newFav);
    return true;
  }
};

/**
 * 检查食谱是否已收藏（同步，从内存缓存判断）
 */
const isRecipeFavorited = (recipeName) => {
  if (!_cache.favorites) return false;
  return _cache.favorites.some(r => r.name === recipeName);
};

// ─── 启动同步（app.onLaunch 时调用）─────────────────

/**
 * 从后端拉取所有用户数据到内存缓存
 * 必须在 app.onLaunch / 登录成功后调用
 */
const syncFromServer = async () => {
  console.log('[Storage] 开始从服务端同步数据...');
  try {
    // 并行加载三个数据源
    const [profileRes, recRes, favRes] = await Promise.allSettled([
      getProfile(true),
      fetchDietRecords(true),
      fetchFavorites(true),
    ]);

    if (profileRes.status === 'rejected') {
      console.warn('[Storage] 用户资料加载失败:', profileRes.reason);
    }
    if (recRes.status === 'rejected') {
      console.warn('[Storage] 饮食记录加载失败:', recRes.reason);
    }
    if (favRes.status === 'rejected') {
      console.warn('[Storage] 收藏列表加载失败:', favRes.reason);
    }

    console.log('[Storage] 数据同步完成', {
      profile: !!_cache.profile,
      records: _cache.dietRecords ? Object.keys(_cache.dietRecords).length : 0,
      favorites: (_cache.favorites || []).length,
    });
  } catch (err) {
    console.warn('[Storage] 数据同步异常:', err);
  }
};

// ─── 营养计算（基于内存缓存中的饮食记录）─────────

/**
 * 计算指定日期的营养摄入
 */
const calcNutrition = (dateStr) => {
  const records = getDietRecords(dateStr);
  let result = { calories: 0, protein: 0, potassium: 0, phosphorus: 0, sodium: 0 };
  records.forEach(r => {
    result.calories += r.nutrition?.calories || 0;
    result.protein += r.nutrition?.protein || 0;
    result.potassium += r.nutrition?.potassium || 0;
    result.phosphorus += r.nutrition?.phosphorus || 0;
    result.sodium += r.nutrition?.sodium || 0;
  });
  return result;
};

// ─── 清除缓存 ──────────────────────────────────────

/**
 * 清除所有内存缓存并重新从服务端加载
 */
const clearAllCache = async () => {
  _cache = {
    profile: null,
    dietRecords: null,
    favorites: null,
    _profileLoaded: false,
    _recordsLoaded: false,
    _favoritesLoaded: false,
  };
  // 重新从服务端加载（此时后端数据应已被清空）
  await syncFromServer();
};

// ─── 导出 ──────────────────────────────────────────
module.exports = {
  // 用户资料
  getProfile,
  getProfileSync,
  getCurrentStage,
  getNickname,
  saveProfileToServer,

  // 饮食记录
  fetchDietRecords,
  getDietRecords,
  addDietRecord,
  deleteDietRecord,
  updateDietRecord,

  // 收藏
  fetchFavorites,
  getFavoriteRecipes,
  toggleFavoriteRecipe,
  isRecipeFavorited,

  // 启动同步
  syncFromServer,

  // 工具函数
  getLast7Days,
  formatDate,
  calcNutrition,
  clearAllCache,
};
