const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const IP_LIMIT = {
  daily_checkin: 10,
  daily_post: 5,
  daily_like: 20,
  daily_comment: 10,
  daily_timed_post: 1
};

const EGGS = [
  { name: '幸运星', shells: 88, chance: 0.01 },
  { name: '红包雨', shells: 50, chance: 0.03 },
  { name: '彩蛋', shells: 20, chance: 0.05 },
  { name: '小惊喜', shells: 10, chance: 0.10 },
  { name: '阳光普照', shells: 5, chance: 0.20 }
];

function rollEgg() {
  const rand = Math.random();
  let cumulative = 0;
  for (const egg of EGGS) {
    cumulative += egg.chance;
    if (rand < cumulative) {
      return egg;
    }
  }
  return null;
}

async function triggerLottery(pool, userId, reason) {
  if (Math.random() < 0.3) {
    const prize = rollEgg();
    if (prize) {
      await pool.execute(
        'UPDATE users SET shells = shells + ? WHERE id = ?',
        [prize.shells, userId]
      );
      return { triggered: true, prize };
    }
  }
  return { triggered: false, prize: null };
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         '127.0.0.1';
}

// 今日活动
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const [holidays] = await pool.execute(
      "SELECT * FROM activities WHERE start_date <= ? AND end_date >= ? AND status = 'active'",
      [today, today]
    );
    
    res.json({
      success: true,
      data: {
        daily: [
          { id: 'daily_checkin', name: '每日签到', reward: 5, description: '每天签到获得贝壳' },
          { id: 'daily_post', name: '每日发帖', reward: 2, description: '每天首次发布内容' },
          { id: 'daily_like', name: '每日点赞', reward: 1, description: '每天首次点赞' },
          { id: 'daily_comment', name: '每日评论', reward: 1, description: '每天首次评论' },
          { id: 'daily_timed_post', name: '定时发布', reward: 2, description: '每天首次定时发布' }
        ],
        holidays: holidays,
        egg: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取所有活动
router.get('/', async (req, res) => {
  try {
    const [activities] = await pool.execute(
      "SELECT * FROM activities WHERE status = 'active' ORDER BY end_date ASC"
    );
    
    if (activities.length === 0) {
      return res.json({
        success: true,
        data: [
          { id: 'default', name: '日常任务', type: 'daily', reward: 5, status: 'active' }
        ]
      });
    }
    
    res.json({ success: true, data: activities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 参与活动（带IP防刷）
router.post('/join', authenticateToken, async (req, res) => {
  try {
    const { activity_id, content } = req.body;
    const userId = req.user.id;
    const clientIp = getClientIp(req);
    const today = new Date().toISOString().split('T')[0];
    
    const limit = IP_LIMIT[activity_id] || 100;
    
    const [ipCount] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM activity_records WHERE activity_id = ? AND ip_address = ? AND DATE(created_at) = ?',
      [activity_id, clientIp, today]
    );
    
    if (ipCount[0].cnt >= limit) {
      return res.json({ 
        success: false, 
        message: '今日次数已达上限，请明天再来',
        limit
      });
    }
    
    let reward = 0;
    let message = '';
    let egg = null;
    
    switch (activity_id) {
      case 'daily_checkin':
        const [checkin] = await pool.execute(
          'SELECT * FROM activity_records WHERE user_id = ? AND activity_id = ? AND DATE(created_at) = ?',
          [userId, 'daily_checkin', today]
        );
        if (checkin.length > 0) {
          return res.json({ success: false, message: '今日已签到' });
        }
        reward = 5;
        message = '签到成功';
        
        await pool.execute(
          'INSERT INTO activity_records (user_id, activity_id, content, reward_shells, ip_address) VALUES (?, ?, ?, ?, ?)',
          [userId, 'daily_checkin', today, reward, clientIp]
        );
        break;
        
      case 'daily_post':
        const [postCheck] = await pool.execute(
          'SELECT * FROM activity_records WHERE user_id = ? AND activity_id = ? AND DATE(created_at) = ?',
          [userId, 'daily_post', today]
        );
        if (postCheck.length > 0) {
          return res.json({ success: false, message: '今日已发帖' });
        }
        reward = 2;
        message = '发帖奖励';
        
        await pool.execute(
          'INSERT INTO activity_records (user_id, activity_id, content, reward_shells, ip_address) VALUES (?, ?, ?, ?, ?)',
          [userId, 'daily_post', content || '', reward, clientIp]
        );
        break;
        
      case 'daily_like':
        const [likeCheck] = await pool.execute(
          'SELECT * FROM activity_records WHERE user_id = ? AND activity_id = ? AND DATE(created_at) = ?',
          [userId, 'daily_like', today]
        );
        if (likeCheck.length > 0) {
          return res.json({ success: false, message: '今日已点赞' });
        }
        reward = 1;
        message = '点赞奖励';
        
        await pool.execute(
          'INSERT INTO activity_records (user_id, activity_id, content, reward_shells, ip_address) VALUES (?, ?, ?, ?, ?)',
          [userId, 'daily_like', content || '', reward, clientIp]
        );
        break;
        
      case 'daily_comment':
        const [commentCheck] = await pool.execute(
          'SELECT * FROM activity_records WHERE user_id = ? AND activity_id = ? AND DATE(created_at) = ?',
          [userId, 'daily_comment', today]
        );
        if (commentCheck.length > 0) {
          return res.json({ success: false, message: '今日已评论' });
        }
        reward = 1;
        message = '评论奖励';
        
        await pool.execute(
          'INSERT INTO activity_records (user_id, activity_id, content, reward_shells, ip_address) VALUES (?, ?, ?, ?, ?)',
          [userId, 'daily_comment', content || '', reward, clientIp]
        );
        break;
        
      case 'daily_timed_post':
        const [timedCheck] = await pool.execute(
          'SELECT * FROM activity_records WHERE user_id = ? AND activity_id = ? AND DATE(created_at) = ?',
          [userId, 'daily_timed_post', today]
        );
        if (timedCheck.length > 0) {
          return res.json({ success: false, message: '今日已定时发布' });
        }
        reward = 2;
        message = '定时发布奖励';
        
        await pool.execute(
          'INSERT INTO activity_records (user_id, activity_id, content, reward_shells, ip_address) VALUES (?, ?, ?, ?, ?)',
          [userId, 'daily_timed_post', content || '', reward, clientIp]
        );
        break;
        
      default:
        return res.json({ success: false, message: '未知活动' });
    }
    
    if (reward > 0) {
      await pool.execute(
        'UPDATE users SET shells = shells + ? WHERE id = ?',
        [reward, userId]
      );
    }
    
    const eggRoll = rollEgg();
    let eggReward = 0;
    if (eggRoll && Math.random() < 0.3) {
      eggReward = eggRoll.shells;
      egg = eggRoll;
      await pool.execute(
        'UPDATE users SET shells = shells + ? WHERE id = ?',
        [eggReward, userId]
      );
    }
    
    res.json({
      success: true,
      message,
      data: {
        activity: activity_id,
        reward: reward,
        shells_earned: reward,
        egg: egg ? { name: egg.name, reward: eggReward } : null,
        total: reward + eggReward,
        ip_limit: limit,
        ip_remaining: limit - ipCount[0].cnt - 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 我的活动记录
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const [records] = await pool.execute(
      'SELECT * FROM activity_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    
    res.json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 今日获得积分
router.get('/today-points', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const [records] = await pool.execute(
      'SELECT SUM(reward_shells) as total FROM activity_records WHERE user_id = ? AND DATE(created_at) = ?',
      [req.user.id, today]
    );
    
    res.json({
      success: true,
      data: {
        shells: records[0].total || 0,
        date: today
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取彩蛋列表
router.get('/eggs', (req, res) => {
  res.json({
    success: true,
    data: EGGS.map(e => ({
      name: e.name,
      reward: e.shells,
      chance: (e.chance * 100).toFixed(1) + '%'
    }))
  });
});

module.exports = router;
module.exports.triggerLottery = triggerLottery;
module.exports.EGGS = EGGS;
