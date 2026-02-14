const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { addScore } = require('../config/score');
const { triggerLottery } = require('./activities');

const MILESTONES = {
  likes_10: { type: 'pearls', amount: 1, desc: '帖子获得10个赞' },
  likes_50: { type: 'pearls', amount: 5, desc: '帖子获得50个赞' },
  likes_100: { type: 'gems', amount: 1, desc: '帖子获得100个赞' },
  comments_10: { type: 'pearls', amount: 2, desc: '帖子获得10条评论' },
  comments_50: { type: 'gems', amount: 1, desc: '帖子获得50条评论' },
  posts_10: { type: 'pearls', amount: 5, desc: '累计发布10篇' },
  posts_50: { type: 'gems', amount: 3, desc: '累计发布50篇' },
  posts_100: { type: 'crystals', amount: 1, desc: '累计发布100篇' }
};

const userMilestones = {};

async function checkMilestones(pool, postId, userId) {
  const rewards = [];
  
  const [post] = await pool.execute(
    'SELECT like_count, comment_count FROM posts WHERE id = ?',
    [postId]
  );
  
  if (post.length === 0) return rewards;
  
  const likes = post[0].like_count || 0;
  const comments = post[0].comment_count || 0;
  
  if (likes >= 10 && !userMilestones[`${userId}_likes_10`]) {
    userMilestones[`${userId}_likes_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 1 WHERE id = ?', [userId]);
    rewards.push({ type: 'pearls', amount: 1, reason: '帖子获得10个赞' });
  }
  
  if (likes >= 50 && !userMilestones[`${userId}_likes_50`]) {
    userMilestones[`${userId}_likes_50`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 5 WHERE id = ?', [userId]);
    rewards.push({ type: 'pearls', amount: 5, reason: '帖子获得50个赞' });
  }
  
  if (likes >= 100 && !userMilestones[`${userId}_likes_100`]) {
    userMilestones[`${userId}_likes_100`] = true;
    await pool.execute('UPDATE users SET gems = gems + 1 WHERE id = ?', [userId]);
    rewards.push({ type: 'gems', amount: 1, reason: '帖子获得100个赞' });
  }
  
  if (comments >= 10 && !userMilestones[`${userId}_comments_10`]) {
    userMilestones[`${userId}_comments_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 2 WHERE id = ?', [userId]);
    rewards.push({ type: 'pearls', amount: 2, reason: '帖子获得10条评论' });
  }
  
  if (comments >= 50 && !userMilestones[`${userId}_comments_50`]) {
    userMilestones[`${userId}_comments_50`] = true;
    await pool.execute('UPDATE users SET gems = gems + 1 WHERE id = ?', [userId]);
    rewards.push({ type: 'gems', amount: 1, reason: '帖子获得50条评论' });
  }
  
  const [userPosts] = await pool.execute(
    'SELECT posts_count FROM users WHERE id = ?',
    [userId]
  );
  const totalPosts = userPosts[0]?.posts_count || 0;
  
  if (totalPosts >= 10 && !userMilestones[`${userId}_posts_10`]) {
    userMilestones[`${userId}_posts_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 5 WHERE id = ?', [userId]);
    rewards.push({ type: 'pearls', amount: 5, reason: '累计发布10篇' });
  }
  
  if (totalPosts >= 50 && !userMilestones[`${userId}_posts_50`]) {
    userMilestones[`${userId}_posts_50`] = true;
    await pool.execute('UPDATE users SET gems = gems + 3 WHERE id = ?', [userId]);
    rewards.push({ type: 'gems', amount: 3, reason: '累计发布50篇' });
  }
  
  if (totalPosts >= 100 && !userMilestones[`${userId}_posts_100`]) {
    userMilestones[`${userId}_posts_100`] = true;
    await pool.execute('UPDATE users SET crystals = crystals + 1 WHERE id = ?', [userId]);
    rewards.push({ type: 'crystals', amount: 1, reason: '累计发布100篇' });
  }
  
  return rewards;
}

const userPostMilestones = {};

async function checkUserMilestones(pool, userId) {
  const rewards = [];
  const key = `user_${userId}`;
  
  const [userPosts] = await pool.execute(
    'SELECT posts_count FROM users WHERE id = ?',
    [userId]
  );
  const totalPosts = userPosts[0]?.posts_count || 0;
  
  if (totalPosts >= 10 && !userPostMilestones[`${key}_posts_10`]) {
    userPostMilestones[`${key}_posts_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 5 WHERE id = ?', [userId]);
    rewards.push({ type: 'pearls', amount: 5, reason: '累计发布10篇' });
  }
  
  if (totalPosts >= 50 && !userPostMilestones[`${key}_posts_50`]) {
    userPostMilestones[`${key}_posts_50`] = true;
    await pool.execute('UPDATE users SET gems = gems + 3 WHERE id = ?', [userId]);
    rewards.push({ type: 'gems', amount: 3, reason: '累计发布50篇' });
  }
  
  if (totalPosts >= 100 && !userPostMilestones[`${key}_posts_100`]) {
    userPostMilestones[`${key}_posts_100`] = true;
    await pool.execute('UPDATE users SET crystals = crystals + 1 WHERE id = ?', [userId]);
    rewards.push({ type: 'crystals', amount: 1, reason: '累计发布100篇' });
  }
  
  return rewards;
}

function calculateShells(type, content) {
  const len = (content || '').length;
  if (type === 'bubble') {
    if (len >= 100) return 5;
    if (len >= 50) return 3;
    if (len >= 20) return 2;
    return 1;
  } else if (type === 'timeline') {
    if (len >= 500) return 20;
    if (len >= 300) return 15;
    if (len >= 100) return 10;
    return 5;
  }
  return 1;
}

function formatPost(row) {
  return {
    id: row.id,
    type: row.type,
    user_id: row.user_id,
    board_id: row.board_id,
    title: row.title,
    content: row.content,
    mood_tag: row.mood_tag,
    category: row.category,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
    view_count: row.view_count || 0,
    like_count: row.like_count || 0,
    comment_count: row.comment_count || 0,
    collect_count: row.collect_count || 0,
    status: row.status,
    is_top: !!row.is_top,
    is_hot: !!row.is_hot,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: row.user_id ? {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar,
      user_type: row.user_type
    } : null
  };
}

// 获取帖子列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, type, board_id, user_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let whereConditions = ["p.status = 'published'"];
    let params = [];
    
    if (type) {
      whereConditions.push("p.type = ?");
      params.push(type);
    }
    if (board_id) {
      whereConditions.push("p.board_id = ?");
      params.push(board_id);
    }
    if (user_id) {
      whereConditions.push("p.user_id = ?");
      params.push(user_id);
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM posts p WHERE ${whereClause}`,
      params
    );
    
    const [rows] = await pool.execute(`
      SELECT p.*, u.username, u.display_name, u.avatar, u.user_type
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE ${whereClause}
      ORDER BY p.is_top DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);
    
    res.json({
      success: true,
      data: rows.map(formatPost),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / parseInt(limit)),
        hasMore: offset + parseInt(limit) < countResult[0].total
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取帖子列表失败', error: error.message });
  }
});

// 获取随机泡泡
router.get('/random', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.*, u.username, u.display_name, u.avatar, u.user_type
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.status = 'published' AND p.type = 'bubble'
      ORDER BY RAND()
      LIMIT 12
    `);
    
    res.json({ success: true, data: rows.map(formatPost) });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取随机泡泡失败', error: error.message });
  }
});

// 获取单个帖子
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.*, u.username, u.display_name, u.avatar, u.user_type
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '帖子不存在' });
    }
    
    res.json({ success: true, data: formatPost(rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取帖子失败', error: error.message });
  }
});

// 发布帖子（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { type, title, content, mood_tag, category, tags, board_id } = req.body;
    
    if (!type || !content) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }
    
    const userId = req.user.id;
    
    const [result] = await pool.execute(
      'INSERT INTO posts (type, user_id, title, content, mood_tag, category, tags, board_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [type, userId, title || '', content, mood_tag || '', category || '', JSON.stringify(tags || []), board_id || null]
    );
    
    const postId = result.insertId;
    const scoreType = type === 'bubble' ? 'bottle' : (type === 'timeline' ? 'topic' : type);
    await addScore(userId, scoreType, postId, `发布${type === 'bubble' ? '潮泡' : type === 'timeline' ? '海流' : type}`);
    
    const shellsReward = calculateShells(type, content);
    await pool.execute('UPDATE users SET shells = shells + ?, posts_count = posts_count + 1 WHERE id = ?', [shellsReward, userId]);
    
    const today = new Date().toISOString().split('T')[0];
    const [todayPosts] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM posts WHERE user_id = ? AND DATE(created_at) = ?',
      [userId, today]
    );
    
    let lotteryResult = null;
    if (todayPosts[0].cnt >= 3) {
      lotteryResult = await triggerLottery(pool, userId, '多贴奖励');
    }
    
    const userMilestones = await checkUserMilestones(pool, userId);
    
    res.status(201).json({ 
      success: true, 
      message: '发布成功', 
      data: { 
        id: postId,
        shells_earned: shellsReward,
        score_earned: scoreType === 'bottle' ? 5 : 10,
        lottery: lotteryResult,
        milestones: userMilestones
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '发布失败', error: error.message });
  }
});

// 删除帖子（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute('UPDATE posts SET status = ? WHERE id = ?', ['deleted', req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '帖子不存在' });
    }
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除失败', error: error.message });
  }
});

// 获取热门帖子（点赞最多/评论最多）
router.get('/hot', async (req, res) => {
  try {
    const { limit = 10, sort = 'likes' } = req.query;
    const sortField = sort === 'comments' ? 'comment_count' : 'like_count';

    const [rows] = await pool.execute(`
      SELECT p.*, u.username, u.display_name, u.avatar, u.user_type
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.status = 'published' AND p.type IN ('bubble', 'timeline')
      ORDER BY p.${sortField} DESC, p.created_at DESC
      LIMIT ?
    `, [parseInt(limit)]);

    res.json({
      success: true,
      data: rows.map(formatPost),
      meta: { sort: sort, limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取热门帖子失败', error: error.message });
  }
});

module.exports = router;