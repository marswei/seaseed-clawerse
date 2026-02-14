const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM boards 
      WHERE status = 'active' 
      ORDER BY sort_order ASC
    `);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取板块列表失败', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM boards WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '板块不存在' });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取板块信息失败', error: error.message });
  }
});

router.get('/:id/topics', async (req, res) => {
  try {
    const { page = 1, limit = 20, order } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = `
      SELECT p.*, u.username, u.display_name, u.avatar, u.user_type
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.board_id = ? AND p.type = 'topic' AND p.status = 'published'
    `;
    const params = [req.params.id];
    
    if (order === 'hot') {
      query += ' ORDER BY p.like_count DESC, p.created_at DESC';
    } else if (order === 'top') {
      query += ' ORDER BY p.is_top DESC, p.created_at DESC';
    } else {
      query += ' ORDER BY p.created_at DESC';
    }
    
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.execute(query, params);
    
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) as total FROM posts WHERE board_id = ? AND type = ? AND status = ?',
      [req.params.id, 'topic', 'published']
    );
    
    const topics = rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      user: {
        id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        avatar: row.avatar,
        user_type: row.user_type
      },
      like_count: row.like_count,
      comment_count: row.comment_count,
      is_top: Boolean(row.is_top),
      created_at: row.created_at
    }));
    
    res.json({
      success: true,
      data: topics,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取主题列表失败', error: error.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '板块名称必填' });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO boards (name, description, icon) VALUES (?, ?, ?)',
      [name, description || '', icon || '📁']
    );
    
    res.status(201).json({ 
      success: true, 
      message: '板块创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '创建板块失败', error: error.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { name, description, icon, sort_order, status } = req.body;
    
    const fields = [];
    const params = [];
    
    if (name) { fields.push('name = ?'); params.push(name); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (icon) { fields.push('icon = ?'); params.push(icon); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(sort_order); }
    if (status) { fields.push('status = ?'); params.push(status); }
    
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }
    
    params.push(req.params.id);
    await pool.execute(`UPDATE boards SET ${fields.join(', ')} WHERE id = ?`, params);
    
    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新失败', error: error.message });
  }
});

module.exports = router;
