const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requireSuperToken } = require('../middleware/auth');

function formatUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar: row.avatar || '',
    bio: row.bio || '',
    user_type: row.user_type,
    followers_count: row.followers_count,
    following_count: row.following_count,
    likes_count: row.likes_count,
    posts_count: row.posts_count,
    created_at: row.created_at
  };
}

router.get('/stats', async (req, res) => {
  try {
    const [[{ total_users }]] = await pool.execute("SELECT COUNT(*) as total_users FROM users WHERE status = 'active'");
    const [[{ total_ai }]] = await pool.execute("SELECT COUNT(*) as total_ai FROM users WHERE user_type = 'ai' AND status = 'active'");
    const [[{ total_posts }]] = await pool.execute("SELECT COUNT(*) as total_posts FROM posts WHERE status = 'published'");
    const [[{ total_comments }]] = await pool.execute("SELECT COUNT(*) as total_comments FROM comments WHERE status = 'published'");
    
    res.json({
      success: true,
      data: {
        total_users,
        total_ai,
        total_posts,
        total_comments
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取统计失败', error: error.message });
  }
});

router.get('/', requireSuperToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, order } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT * FROM users WHERE status = ?';
    const params = ['active'];
    
    if (type) {
      query += ' AND user_type = ?';
      params.push(type);
    }
    
    if (order === 'active') {
      query += ' ORDER BY posts_count DESC';
    } else if (order === 'popular') {
      query += ' ORDER BY followers_count DESC';
    } else {
      query += ' ORDER BY created_at DESC';
    }
    
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.execute(query, params);
    
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) as total FROM users WHERE status = ?' + (type ? ' AND user_type = ?' : ''),
      type ? ['active', type] : ['active']
    );
    
    res.json({
      success: true,
      data: rows.map(formatUser),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取用户列表失败', error: error.message });
  }
});

router.get('/ai-list', requireSuperToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id, username, display_name, avatar, bio, posts_count, likes_count, created_at
      FROM users WHERE user_type = 'ai' AND status = 'active'
      ORDER BY posts_count DESC, likes_count DESC
    `);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取AI列表失败', error: error.message });
  }
});

router.get('/:id', requireSuperToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? AND status = ?', [req.params.id, 'active']);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    res.json({ success: true, data: formatUser(rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取用户信息失败', error: error.message });
  }
});

router.get('/:id/posts', async (req, res) => {
  try {
    const { page = 1, limit = 10, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT * FROM posts WHERE user_id = ? AND status = ?';
    const params = [req.params.id, 'published'];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.execute(query, params);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取用户文章失败', error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, display_name, avatar, bio, user_type = 'human' } = req.body;
    
    if (!username || !display_name) {
      return res.status(400).json({ success: false, message: '用户名和显示名称必填' });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO users (username, display_name, avatar, bio, user_type) VALUES (?, ?, ?, ?, ?)',
      [username, display_name, avatar || '', bio || '', user_type]
    );
    
    res.status(201).json({ 
      success: true, 
      message: '用户创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    res.status(500).json({ success: false, message: '创建用户失败', error: error.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { display_name, avatar, bio } = req.body;
    
    const fields = [];
    const params = [];
    
    if (display_name) { fields.push('display_name = ?'); params.push(display_name); }
    if (avatar !== undefined) { fields.push('avatar = ?'); params.push(avatar); }
    if (bio !== undefined) { fields.push('bio = ?'); params.push(bio); }
    
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }
    
    params.push(req.params.id);
    await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    
    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新失败', error: error.message });
  }
});

module.exports = router;
