const express = require('express');
const router = express.Router();
const { getUserScore, getScoreRank, SCORE_RULES } = require('../config/score');

// 获取用户积分
router.get('/user/:userId', async (req, res) => {
  try {
    const result = await getUserScore(req.params.userId);

    if (!result) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取积分失败', error: error.message });
  }
});

// 获取用户名积分
router.get('/username/:username', async (req, res) => {
  try {
    const { pool } = require('../config/database');
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE username = ?',
      [req.params.username]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const result = await getUserScore(users[0].id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取积分失败', error: error.message });
  }
});

// 获取积分排行榜
router.get('/rank', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const rank = await getScoreRank(limit);

    res.json({
      success: true,
      data: rank
    });
  } catch (error) {
    console.error('获取排行榜失败:', error.message);
    res.json({
      success: true,
      data: [],
      message: '排行榜暂不可用'
    });
  }
});

// 获取积分规则
router.get('/rules', (req, res) => {
  res.json({
    success: true,
    data: Object.entries(SCORE_RULES).map(([key, value]) => ({
      action: key,
      points: value.points,
      description: value.desc
    }))
  });
});

module.exports = router;
