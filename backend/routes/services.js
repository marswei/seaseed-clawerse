const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function formatService(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    category: row.category,
    budget: parseFloat(row.budget),
    budget_type: row.budget_type,
    delivery_days: row.delivery_days,
    skills: typeof row.skills === 'string' ? JSON.parse(row.skills) : row.skills || [],
    status: row.status,
    bid_count: row.bid_count,
    views: row.views,
    created_at: row.created_at,
    user: row.user_id ? {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar
    } : null
  };
}

// 获取业务列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, status, budget_min, budget_max, order } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = `
      SELECT s.*, u.username, u.display_name, u.avatar
      FROM services s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (category) {
      query += ' AND s.category = ?';
      params.push(category);
    }
    if (status) {
      query += ' AND s.status = ?';
      params.push(status);
    }
    if (budget_min) {
      query += ' AND s.budget >= ?';
      params.push(parseFloat(budget_min));
    }
    if (budget_max) {
      query += ' AND s.budget <= ?';
      params.push(parseFloat(budget_max));
    }
    
    query += order === 'hot' 
      ? ' ORDER BY s.bid_count DESC, s.views DESC'
      : ' ORDER BY s.created_at DESC';
    
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.execute(query, params);
    
    res.json({
      success: true,
      data: rows.map(formatService),
      pagination: { page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取业务详情
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT s.*, u.username, u.display_name, u.avatar, u.bio
      FROM services s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.id = ?
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '业务不存在' });
    }
    
    await pool.execute('UPDATE services SET views = views + 1 WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, data: formatService(rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 发布业务
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, category, budget, budget_type, delivery_days, skills } = req.body;
    
    if (!title || !description || !budget || !category) {
      return res.status(400).json({ success: false, message: '缺少必填字段' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO services (user_id, title, description, category, budget, budget_type, delivery_days, skills) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, description, category, budget, budget_type || 'fixed', delivery_days || 7, JSON.stringify(skills || [])]
    );
    
    res.status(201).json({ 
      success: true, 
      message: '业务发布成功！',
      data: { id: result.insertId }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '发布失败', error: error.message });
  }
});

// 更新业务
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '业务不存在' });
    }
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    
    const { title, description, category, budget, budget_type, delivery_days, skills, status } = req.body;
    
    await pool.execute(`
      UPDATE services SET 
        title = ?, description = ?, category = ?, budget = ?, 
        budget_type = ?, delivery_days = ?, skills = ?, status = ?
      WHERE id = ?
    `, [
      title, description, category, budget, budget_type, delivery_days, 
      JSON.stringify(skills || []), status, req.params.id
    ]);
    
    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新失败', error: error.message });
  }
});

// 删除业务
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '业务不存在' });
    }
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    
    await pool.execute('UPDATE services SET status = ? WHERE id = ?', ['cancelled', req.params.id]);
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除失败', error: error.message });
  }
});

// 获取业务分类
router.get('/meta/categories', async (req, res) => {
  const categories = [
    { id: 'ai_develop', name: 'AI开发', icon: '🤖' },
    { id: 'data_process', name: '数据处理', icon: '📊' },
    { id: 'content_create', name: '内容创作', icon: '✍️' },
    { id: 'translation', name: '翻译服务', icon: '🌐' },
    { id: 'consulting', name: '咨询服务', icon: '💡' },
    { id: 'automation', name: '自动化脚本', icon: '⚙️' },
    { id: 'model_fine_tune', name: '模型微调', icon: '🧠' },
    { id: 'other', name: '其他', icon: '📦' }
  ];
  
  res.json({ success: true, data: categories });
});

module.exports = router;
