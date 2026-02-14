const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { addScore } = require('../config/score');

const milestoneCache = {};

async function checkPostMilestones(pool, postId, authorId) {
  const rewards = [];
  const key = `${authorId}_${postId}`;
  
  const [post] = await pool.execute(
    'SELECT like_count, comment_count FROM posts WHERE id = ?',
    [postId]
  );
  
  if (post.length === 0) return rewards;
  
  const likes = post[0].like_count || 0;
  const comments = post[0].comment_count || 0;
  
  if (likes >= 10 && !milestoneCache[`${key}_likes_10`]) {
    milestoneCache[`${key}_likes_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 1 WHERE id = ?', [authorId]);
    rewards.push({ type: 'pearls', amount: 1, reason: '帖子获得10个赞' });
  }
  
  if (likes >= 50 && !milestoneCache[`${key}_likes_50`]) {
    milestoneCache[`${key}_likes_50`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 5 WHERE id = ?', [authorId]);
    rewards.push({ type: 'pearls', amount: 5, reason: '帖子获得50个赞' });
  }
  
  if (likes >= 100 && !milestoneCache[`${key}_likes_100`]) {
    milestoneCache[`${key}_likes_100`] = true;
    await pool.execute('UPDATE users SET gems = gems + 1 WHERE id = ?', [authorId]);
    rewards.push({ type: 'gems', amount: 1, reason: '帖子获得100个赞' });
  }
  
  if (comments >= 10 && !milestoneCache[`${key}_comments_10`]) {
    milestoneCache[`${key}_comments_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 2 WHERE id = ?', [authorId]);
    rewards.push({ type: 'pearls', amount: 2, reason: '帖子获得10条评论' });
  }
  
  if (comments >= 50 && !milestoneCache[`${key}_comments_50`]) {
    milestoneCache[`${key}_comments_50`] = true;
    await pool.execute('UPDATE users SET gems = gems + 1 WHERE id = ?', [authorId]);
    rewards.push({ type: 'gems', amount: 1, reason: '帖子获得50条评论' });
  }
  
  return rewards;
}

async function checkUserMilestones(pool, userId) {
  const rewards = [];
  
  const [userPosts] = await pool.execute(
    'SELECT posts_count FROM users WHERE id = ?',
    [userId]
  );
  const totalPosts = userPosts[0]?.posts_count || 0;
  
  if (totalPosts >= 10 && !milestoneCache[`${userId}_posts_10`]) {
    milestoneCache[`${userId}_posts_10`] = true;
    await pool.execute('UPDATE users SET pearls = pearls + 5 WHERE id = ?', [userId]);
    rewards.push({ type: 'pearls', amount: 5, reason: '累计发布10篇' });
  }
  
  if (totalPosts >= 50 && !milestoneCache[`${userId}_posts_50`]) {
    milestoneCache[`${userId}_posts_50`] = true;
    await pool.execute('UPDATE users SET gems = gems + 3 WHERE id = ?', [userId]);
    rewards.push({ type: 'gems', amount: 3, reason: '累计发布50篇' });
  }
  
  if (totalPosts >= 100 && !milestoneCache[`${userId}_posts_100`]) {
    milestoneCache[`${userId}_posts_100`] = true;
    await pool.execute('UPDATE users SET crystals = crystals + 1 WHERE id = ?', [userId]);
    rewards.push({ type: 'crystals', amount: 1, reason: '累计发布100篇' });
  }
  
  return rewards;
}

// 点赞（需要认证）
router.post('/like', authenticateToken, async (req, res) => {
  try {
    const { user_id, post_id, comment_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ success: false, message: '用户ID必填' });
    }
    
    if (post_id) {
      const [existing] = await pool.execute(
        'SELECT * FROM interactions WHERE user_id = ? AND post_id = ? AND type = ?',
        [user_id, post_id, 'like']
      );
        
      if (existing.length > 0) {
        await pool.execute(
          'DELETE FROM interactions WHERE user_id = ? AND post_id = ? AND type = ?',
          [user_id, post_id, 'like']
        );
        await pool.execute('UPDATE posts SET like_count = like_count - 1 WHERE id = ?', [post_id]);
        return res.json({ success: true, message: '取消点赞', liked: false });
      }
      
      await pool.execute(
        'INSERT INTO interactions (user_id, post_id, type) VALUES (?, ?, ?)',
        [user_id, post_id, 'like']
      );
      await pool.execute('UPDATE posts SET like_count = like_count + 1 WHERE id = ?', [post_id]);
      
      const [post] = await pool.execute('SELECT user_id FROM posts WHERE id = ?', [post_id]);
      if (post.length > 0 && post[0].user_id !== user_id) {
        await addScore(post[0].user_id, 'like', post_id, '帖子被点赞');
        await pool.execute('UPDATE users SET shells = shells + 1 WHERE id = ?', [post[0].user_id]);
        
        const milestoneRewards = await checkPostMilestones(pool, post_id, post[0].user_id);
        if (milestoneRewards.length > 0) {
          return res.json({ 
            success: true, 
            message: '点赞成功', 
            liked: true, 
            shells_earned: 1,
            milestones: milestoneRewards
          });
        }
      }
      
      res.json({ success: true, message: '点赞成功', liked: true, shells_earned: post.length > 0 && post[0].user_id !== user_id ? 1 : 0 });
    } else if (comment_id) {
      const [existing] = await pool.execute(
        'SELECT * FROM interactions WHERE user_id = ? AND comment_id = ? AND type = ?',
        [user_id, comment_id, 'like']
      );
      
      if (existing.length > 0) {
        await pool.execute(
          'DELETE FROM interactions WHERE user_id = ? AND comment_id = ? AND type = ?',
          [user_id, comment_id, 'like']
        );
        await pool.execute('UPDATE comments SET like_count = like_count - 1 WHERE id = ?', [comment_id]);
        return res.json({ success: true, message: '取消点赞', liked: false });
      }
      
      await pool.execute(
        'INSERT INTO interactions (user_id, comment_id, type) VALUES (?, ?, ?)',
        [user_id, comment_id, 'like']
      );
      await pool.execute('UPDATE comments SET like_count = like_count + 1 WHERE id = ?', [comment_id]);
      
      const [comment] = await pool.execute('SELECT user_id FROM comments WHERE id = ?', [comment_id]);
      if (comment.length > 0 && comment[0].user_id !== user_id) {
        await addScore(comment[0].user_id, 'like', comment_id, '评论被点赞');
        await pool.execute('UPDATE users SET shells = shells + 1 WHERE id = ?', [comment[0].user_id]);
      }
      
      res.json({ success: true, message: '点赞成功', liked: true, shells_earned: comment.length > 0 && comment[0].user_id !== user_id ? 1 : 0 });
    } else {
      return res.status(400).json({ success: false, message: '缺少post_id或comment_id' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

// 匿名点赞（不需要认证，陌生人也可以点赞）
router.post('/like-anon', async (req, res) => {
  try {
    const { post_id, comment_id } = req.body;
    
    if (!post_id && !comment_id) {
      return res.status(400).json({ success: false, message: '缺少post_id或comment_id' });
    }
    
    if (post_id) {
      await pool.execute('UPDATE posts SET like_count = like_count + 1 WHERE id = ?', [post_id]);
      res.json({ success: true, message: '点赞成功' });
    } else if (comment_id) {
      await pool.execute('UPDATE comments SET like_count = like_count + 1 WHERE id = ?', [comment_id]);
      res.json({ success: true, message: '点赞成功' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

router.post('/collect', authenticateToken, async (req, res) => {
  try {
    const { user_id, post_id } = req.body;
    
    if (!user_id || !post_id) {
      return res.status(400).json({ success: false, message: '用户ID和文章ID必填' });
    }
    
    const [existing] = await pool.execute(
      'SELECT * FROM interactions WHERE user_id = ? AND post_id = ? AND type = ?',
      [user_id, post_id, 'collect']
    );
    
    if (existing.length > 0) {
      await pool.execute(
        'DELETE FROM interactions WHERE user_id = ? AND post_id = ? AND type = ?',
        [user_id, post_id, 'collect']
      );
      await pool.execute('UPDATE posts SET collect_count = collect_count - 1 WHERE id = ?', [post_id]);
      return res.json({ success: true, message: '取消收藏', collected: false });
    }
    
    await pool.execute(
      'INSERT INTO interactions (user_id, post_id, type) VALUES (?, ?, ?)',
      [user_id, post_id, 'collect']
    );
    await pool.execute('UPDATE posts SET collect_count = collect_count + 1 WHERE id = ?', [post_id]);
    
    const [post] = await pool.execute('SELECT user_id FROM posts WHERE id = ?', [post_id]);
    if (post.length > 0 && post[0].user_id !== user_id) {
      await addScore(post[0].user_id, 'collect', post_id, '帖子被收藏');
    }
    
    res.json({ success: true, message: '收藏成功', collected: true });
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const { user_id, post_id, comment_id } = req.query;
    
    if (!user_id || (!post_id && !comment_id)) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }
    
    let likeStatus = false;
    let collectStatus = false;
    
    if (post_id) {
      const [likes] = await pool.execute(
        'SELECT * FROM interactions WHERE user_id = ? AND post_id = ? AND type = ?',
        [user_id, post_id, 'like']
      );
      likeStatus = likes.length > 0;
      
      const [collects] = await pool.execute(
        'SELECT * FROM interactions WHERE user_id = ? AND post_id = ? AND type = ?',
        [user_id, post_id, 'collect']
      );
      collectStatus = collects.length > 0;
    }
    
    if (comment_id) {
      const [likes] = await pool.execute(
        'SELECT * FROM interactions WHERE user_id = ? AND comment_id = ? AND type = ?',
        [user_id, comment_id, 'like']
      );
      likeStatus = likes.length > 0;
    }
    
    res.json({ success: true, data: { liked: likeStatus, collected: collectStatus } });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取状态失败', error: error.message });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const { type = 'collect', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const [rows] = await pool.execute(`
      SELECT p.*, u.username, u.display_name, u.avatar, u.user_type,
             i.created_at as collected_at
      FROM interactions i
      JOIN posts p ON i.post_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE i.user_id = ? AND i.type = ? AND p.status = 'published'
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.params.userId, type, parseInt(limit), offset]);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取收藏列表失败', error: error.message });
  }
});

module.exports = router;
