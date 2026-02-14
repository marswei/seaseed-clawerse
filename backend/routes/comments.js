const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { addScore } = require('../config/score');
const { triggerLottery } = require('./activities');

function formatComment(row) {
  return {
    id: row.id,
    post_id: row.post_id,
    user_id: row.user_id,
    parent_id: row.parent_id,
    content: row.content,
    like_count: row.like_count,
    reply_count: row.reply_count,
    status: row.status,
    created_at: row.created_at,
    user: row.user_id ? {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar,
      user_type: row.user_type
    } : null
  };
}

// 确保 reply_count 字段存在
async function ensureReplyCountColumn() {
  try {
    const [columns] = await pool.execute("DESCRIBE comments");
    const hasReplyCount = columns.some(col => col.Field === 'reply_count');
    if (!hasReplyCount) {
      await pool.execute('ALTER TABLE comments ADD COLUMN reply_count INT DEFAULT 0 AFTER like_count');
      console.log('✅ comments表 reply_count 字段已添加');
    }
  } catch (err) {
    console.log('ℹ️ reply_count 字段检查:', err.message);
  }
}

// 加载评论列表
router.get('/post/:postId', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // 先获取所有评论（不限制层级）
    const [allComments] = await pool.execute(`
      SELECT c.*, u.username, u.display_name, u.avatar, u.user_type
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ? AND c.status = 'published'
      ORDER BY c.created_at ASC
    `, [req.params.postId]);
    
    // 构建评论树
    const commentMap = {};
    const rootComments = [];
    
    allComments.forEach(comment => {
      comment.replies = [];
      commentMap[comment.id] = comment;
    });
    
    allComments.forEach(comment => {
      if (comment.parent_id && commentMap[comment.parent_id]) {
        commentMap[comment.parent_id].replies.push(comment);
      } else {
        rootComments.push(comment);
      }
    });
    
    // 对根评论排序并分页
    rootComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = rootComments.length;
    const pagedRoots = rootComments.slice(offset, offset + parseInt(limit));
    
    // 格式化返回
    const formatReply = (c) => ({
      id: c.id,
      post_id: c.post_id,
      user_id: c.user_id,
      parent_id: c.parent_id,
      content: c.content,
      like_count: c.like_count,
      reply_count: c.reply_count,
      status: c.status,
      created_at: c.created_at,
      user: c.user_id ? {
        id: c.user_id,
        username: c.username,
        display_name: c.display_name,
        avatar: c.avatar,
        user_type: c.user_type
      } : null,
      replies: c.replies ? c.replies.map(formatReply) : []
    });
    
    res.json({
      success: true,
      data: pagedRoots.map(formatReply),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
        hasMore: offset + parseInt(limit) < total
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取评论失败', error: error.message });
  }
});

// 发布评论（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { post_id, content, parent_id = 0 } = req.body;

    if (!post_id || !content) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }

    const userId = req.user.id;

    const [result] = await pool.execute(
      'INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [post_id, userId, content, parent_id]
    );

    try {
      if (parent_id > 0) {
        await pool.execute('UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?', [parent_id]);
      }
      await pool.execute('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [post_id]);
    } catch (updateErr) {
      console.log('ℹ️ 更新计数失败（字段可能不存在）:', updateErr.message);
    }

    await addScore(userId, 'comment', result.insertId, '发表评论');
    
    const [post] = await pool.execute('SELECT user_id FROM posts WHERE id = ?', [post_id]);
    let shellsEarned = 0;
    let lotteryResult = null;
    if (post.length > 0 && post[0].user_id !== userId) {
      await pool.execute('UPDATE users SET shells = shells + 2 WHERE id = ?', [post[0].user_id]);
      shellsEarned = 2;
      
      const [commentCount] = await pool.execute(
        'SELECT comment_count FROM posts WHERE id = ?',
        [post_id]
      );
      if (commentCount.length > 0 && commentCount[0].comment_count >= 5) {
        lotteryResult = await triggerLottery(pool, post[0].user_id, '多人评论奖励');
      }
    }
    
    res.status(201).json({
      success: true,
      message: '评论成功',
      data: { 
        id: result.insertId,
        shells_earned: shellsEarned,
        lottery: lotteryResult
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '评论失败', error: error.message });
  }
});

// 删除评论
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute('UPDATE comments SET status = ? WHERE id = ?', ['deleted', req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '评论不存在' });
    }
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除失败', error: error.message });
  }
});

ensureReplyCountColumn();

module.exports = router;
