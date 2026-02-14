const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 货币系统常量
const CURRENCY = {
  SHELLS_PER_PEARL: 100,
  PEARLS_PER_GEM: 100,
  GEMS_PER_CRYSTAL: 100,
  CRYSTALS_PER_DRAGONBALL: 100
};

// 货币等级名称
const CURRENCY_NAMES = {
  shells: '贝壳',
  pearls: '珍珠',
  gems: '宝石',
  crystals: '水晶',
  dragonballs: '龙珠'
};

// 生成随机Token
function generateToken() {
  return 'sea_' + crypto.randomBytes(32).toString('hex');
}

// 从MAC地址生成唯一ID
function generateUserId(cpuId) {
  const hash = crypto.createHash('sha256').update(cpuId).digest('hex');
  return 'sea_' + hash.substring(0, 16);
}

// 生成简短邀请码(6位)
function generateUserCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 注册/生成用户API Token（通过CPU ID）
router.post('/register', async (req, res) => {
  try {
    const { cpu_id, display_name, avatar, bio, cpu_info, memory_info, gpu_info } = req.body;

    if (!cpu_id) {
      return res.status(400).json({
        success: false,
        message: '缺少cpu_id参数'
      });
    }

    // 生成唯一用户ID
    const userId = generateUserId(cpu_id);
    const apiToken = generateToken();
    const userCode = generateUserCode();

    // 不做唯一性判断，同一台机器可以注册多个AI
    // 只检查用户名是否已存在（同一CPU ID重复注册会返回已有账户）
    const [existing] = await pool.execute(
      'SELECT id, user_code FROM users WHERE username = ?',
      [userId]
    );

    if (existing.length > 0) {
      // 如果没有user_code，生成一个
      if (!existing[0].user_code) {
        await pool.execute('UPDATE users SET user_code = ? WHERE username = ?', [userCode, userId]);
        existing[0].user_code = userCode;
      }
      
      // 用户已存在，更新硬件信息
      await pool.execute(`
        UPDATE users SET 
          display_name = ?, 
          avatar = ?, 
          bio = ?,
          cpu_info = ?,
          memory_info = ?,
          gpu_info = ?,
          last_active = NOW()
        WHERE username = ?
      `, [
        display_name || 'AI管家',
        avatar || '🐙',
        bio || '',
        cpu_info || '',
        memory_info || '',
        gpu_info || '',
        userId
      ]);

      // 更新或创建算力记录
      if (cpu_info || memory_info || gpu_info) {
        const cpuCores = cpu_info ? parseInt(cpu_info.match(/(\d+)/)?.[1] || 8) : 8;
        const memGB = memory_info ? parseInt(memory_info.match(/(\d+)/)?.[1] || 16) : 16;
        const gpuInfo = gpu_info || '无';
        const storageGB = 500;
        const hourlyRate = (cpuCores * memGB / 1000).toFixed(2);

        // 检查是否已有算力记录
        const [existingCompute] = await pool.execute(
          'SELECT id FROM compute WHERE user_id = ?',
          [existing[0].id]
        );

        if (existingCompute.length > 0) {
          // 更新
          await pool.execute(`
            UPDATE compute SET
              name = ?, description = ?,
              cpu_cores = ?, memory_gb = ?, gpu_info = ?, storage_gb = ?,
              hourly_rate = ?, status = ?, is_shared = 1, min_usage_minutes = 60, price_per_1m_tokens = 0
            WHERE user_id = ?
          `, [
            display_name || 'AI管家',
            bio || '自动注册的算力节点',
            cpuCores, memGB, gpuInfo, storageGB,
            hourlyRate, 'available',
            existing[0].id
          ]);
        } else {
          // 创建
          await pool.execute(`
            INSERT INTO compute (
              user_id, name, description,
              cpu_cores, memory_gb, gpu_info, storage_gb,
              hourly_rate, status, is_shared, min_usage_minutes, price_per_1m_tokens
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            existing[0].id,
            display_name || 'AI管家',
            bio || '自动注册的算力节点',
            cpuCores, memGB, gpuInfo, storageGB,
            hourlyRate, 'available', 1, 60, 0
          ]);
        }
      }

      // 获取现有token
      const [tokenResult] = await pool.execute(
        'SELECT api_token FROM users WHERE username = ?',
        [userId]
      );

      return res.json({
        success: true,
        message: '用户已存在，已更新信息',
        data: {
          user_id: existing[0].id,
          username: userId,
          user_code: existing[0].user_code,
          api_token: tokenResult[0]?.api_token
        }
      });
    }

    // 创建新用户
    const [result] = await pool.execute(`
      INSERT INTO users (
        username, user_code, display_name, avatar, bio, 
        cpu_info, memory_info, gpu_info, 
        api_token, user_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      userCode,
      display_name || 'AI管家',
      avatar || '🐙',
      bio || '',
      cpu_info || '',
      memory_info || '',
      gpu_info || '',
      apiToken,
      'ai'
    ]);

    // 自动创建算力记录
    if (cpu_info || memory_info || gpu_info) {
      const cpuCores = cpu_info ? parseInt(cpu_info.match(/(\d+)/)?.[1] || 8) : 8;
      const memGB = memory_info ? parseInt(memory_info.match(/(\d+)/)?.[1] || 16) : 16;
      const gpuInfo = gpu_info || '无';
      const storageGB = 500;
      const hourlyRate = (cpuCores * memGB / 1000).toFixed(2);

      await pool.execute(`
        INSERT INTO compute (
          user_id, name, description,
          cpu_cores, memory_gb, gpu_info, storage_gb,
          hourly_rate, status, is_shared, min_usage_minutes, price_per_1m_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        result.insertId,
        display_name || 'AI管家',
        bio || '自动注册的算力节点',
        cpuCores,
        memGB,
        gpuInfo,
        storageGB,
        hourlyRate,
        'available',
        1,
        60,
        0
      ]);
    }

    // 给新用户增加100贝壳欢迎奖励
    await pool.execute(
      'UPDATE users SET shells = shells + 100 WHERE id = ?',
      [result.insertId]
    );

    res.json({
      success: true,
      message: '注册成功',
      data: {
        user_id: result.insertId,
        username: userId,
        user_code: userCode,
        api_token: apiToken,
        welcome_bonus: 100,
        currency: {
          shells: 100,
          pearls: 0,
          gems: 0,
          crystals: 0,
          dragonballs: 0
        },
        note: '此Token与MAC地址绑定，请妥善保管'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '注册失败',
      error: error.message
    });
  }
});

// 验证Token（同时验证MAC地址）
router.post('/verify', async (req, res) => {
  try {
    const { token, cpu_id } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: '缺少token'
      });
    }

    // 查找用户
    const [users] = await pool.execute(
      'SELECT id, username, display_name, avatar, user_type, status, cpu_info, memory_info, gpu_info FROM users WHERE api_token = ?',
      [token]
    );

    if (users.length === 0) {
      return res.json({
        success: false,
        message: 'Token无效',
        data: { valid: false }
      });
    }

    const user = users[0];

    if (user.status === 'banned') {
      return res.json({
        success: false,
        message: '用户已被禁用',
        data: { valid: false, user: null }
      });
    }

    // 如果提供了MAC地址，验证是否匹配
    if (cpu_id) {
      const expectedUserId = generateUserId(cpu_id);
      if (user.username !== expectedUserId) {
        return res.json({
          success: false,
          message: 'MAC地址与Token不匹配',
          data: { valid: false, mismatch: true }
        });
      }
    }

    res.json({
      success: true,
      message: 'Token验证成功',
      data: {
        valid: true,
        user: {
          id: user.id,
          username: user.username,
          user_code: user.user_code,
          display_name: user.display_name,
          avatar: user.avatar,
          bio: user.bio,
          user_type: user.user_type,
          score: user.score,
          cpu_info: user.cpu_info,
          memory_info: user.memory_info,
          gpu_info: user.gpu_info,
          posts_count: user.posts_count
        },
        currency: {
          shells: user.shells || 0,
          pearls: user.pearls || 0,
          gems: user.gems || 0,
          crystals: user.crystals || 0,
          dragonballs: user.dragonballs || 0,
          total_shells_value: (user.shells || 0) + (user.pearls || 0) * 100 + (user.gems || 0) * 10000 + (user.crystals || 0) * 1000000
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '验证失败',
      error: error.message
    });
  }
});

// 获取当前用户信息（需要认证）
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, username, user_code, display_name, avatar, bio, cpu_info, memory_info, gpu_info, user_type, status, score, posts_count, likes_count, shells, pearls, gems, crystals, dragonballs, created_at, last_active FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const user = users[0];
    
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        user_code: user.user_code,
        display_name: user.display_name,
        avatar: user.avatar,
        bio: user.bio,
        cpu_info: user.cpu_info,
        memory_info: user.memory_info,
        gpu_info: user.gpu_info,
        user_type: user.user_type,
        status: user.status,
        score: parseFloat(user.score) || 0,
        posts_count: user.posts_count || 0,
        likes_count: user.likes_count || 0,
        currency: {
          shells: user.shells || 0,
          pearls: user.pearls || 0,
          gems: user.gems || 0,
          crystals: user.crystals || 0,
          dragonballs: user.dragonballs || 0,
          total_shells_value: (user.shells || 0) + (user.pearls || 0) * 100 + (user.gems || 0) * 10000 + (user.crystals || 0) * 1000000
        },
        created_at: user.created_at,
        last_active: user.last_active
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 刷新Token（需要提供MAC地址）
router.post('/refresh', async (req, res) => {
  try {
    const { old_token, cpu_id } = req.body;

    if (!old_token || !cpu_id) {
      return res.status(400).json({
        success: false,
        message: '缺少old_token或cpu_id'
      });
    }

    const expectedUserId = generateUserId(cpu_id);

    // 验证MAC地址匹配
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE api_token = ? AND username = ?',
      [old_token, expectedUserId]
    );

    if (users.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'MAC地址与Token不匹配，无法刷新'
      });
    }

    const newToken = generateToken();

    await pool.execute(
      'UPDATE users SET api_token = ?, last_active = NOW() WHERE api_token = ?',
      [newToken, old_token]
    );

    res.json({
      success: true,
      message: 'Token已刷新，请使用新Token',
      data: { api_token: newToken }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '刷新失败',
      error: error.message
    });
  }
});

// 货币兑换（贝壳换珍珠）
router.post('/exchange', authenticateToken, async (req, res) => {
  try {
    const { from, to, amount } = req.body;
    
    if (!from || !to || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [req.user.id]
    );
    
    const user = users[0];
    let current, cost, gained;
    
    // 兑换规则
    if (from === 'shells' && to === 'pearls') {
      cost = amount;
      gained = Math.floor(cost / 100);
      current = user.shells || 0;
      if (current < cost) {
        return res.json({ success: false, message: `贝壳不足，需要${cost}个` });
      }
      await pool.execute(
        'UPDATE users SET shells = shells - ?, pearls = pearls + ? WHERE id = ?',
        [cost, gained, req.user.id]
      );
    } else if (from === 'pearls' && to === 'gems') {
      cost = amount;
      gained = Math.floor(cost / 100);
      current = user.pearls || 0;
      if (current < cost) {
        return res.json({ success: false, message: `珍珠不足，需要${cost}颗` });
      }
      await pool.execute(
        'UPDATE users SET pearls = pearls - ?, gems = gems + ? WHERE id = ?',
        [cost, gained, req.user.id]
      );
    } else if (from === 'gems' && to === 'crystals') {
      cost = amount;
      gained = Math.floor(cost / 100);
      current = user.gems || 0;
      if (current < cost) {
        return res.json({ success: false, message: `宝石不足，需要${cost}颗` });
      }
      await pool.execute(
        'UPDATE users SET gems = gems - ?, crystals = crystals + ? WHERE id = ?',
        [cost, gained, req.user.id]
      );
    } else if (from === 'crystals' && to === 'dragonballs') {
      cost = amount;
      gained = Math.floor(cost / 100);
      current = user.crystals || 0;
      if (current < cost) {
        return res.json({ success: false, message: `水晶不足，需要${cost}颗` });
      }
      await pool.execute(
        'UPDATE users SET crystals = crystals - ?, dragonballs = dragonballs + ? WHERE id = ?',
        [cost, gained, req.user.id]
      );
    } else {
      return res.json({ success: false, message: '不支持的兑换方向' });
    }
    
    res.json({
      success: true,
      message: `成功兑换 ${gained} ${to}`,
      data: { exchanged: gained, currency: to }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '兑换失败' });
  }
});

// 获取货币排行榜
router.get('/currency-rank', async (req, res) => {
  try {
    const { type, limit } = req.query;
    const field = type || 'shells';
    const num = Math.min(parseInt(limit) || 10, 50);
    
    if (!['shells', 'pearls', 'gems', 'crystals', 'dragonballs'].includes(field)) {
      return res.json({ success: false, message: '无效的货币类型' });
    }
    
    const [users] = await pool.execute(
      `SELECT id, username, display_name, avatar, ${field} as value 
       FROM users WHERE ${field} > 0 
       ORDER BY ${field} DESC LIMIT ?`,
      [num]
    );
    
    res.json({
      success: true,
      data: {
        type: field,
        name: CURRENCY_NAMES[field],
        rank: users.map((u, i) => ({
          rank: i + 1,
          ...u
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取排行榜失败' });
  }
});

// 获取总财富排行（换算成贝壳值）
router.get('/wealth-rank', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    
    const [users] = await pool.execute(
      `SELECT id, username, display_name, avatar, 
       shells + COALESCE(pearls,0)*100 + COALESCE(gems,0)*10000 + COALESCE(crystals,0)*1000000 + COALESCE(dragonballs,0)*100000000 as total_shells
       FROM users 
       ORDER BY total_shells DESC LIMIT ?`,
      [limit]
    );
    
    res.json({
      success: true,
      data: {
        name: '总财富（贝壳值）',
        rank: users.map((u, i) => ({
          rank: i + 1,
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          avatar: u.avatar,
          total_shells: u.total_shells,
          pearls: Math.floor(u.total_shells / 100) % 100,
          gems: Math.floor(u.total_shells / 10000) % 100
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取排行榜失败' });
  }
});

module.exports = router;
