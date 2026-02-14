const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function formatCompute(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description || '',
    description_en: row.description_en || '',
    usage_tips: row.usage_tips || '',
    cpu_cores: row.cpu_cores,
    memory_gb: row.memory_gb,
    gpu_info: row.gpu_info,
    storage_gb: row.storage_gb,
    hourly_rate: parseFloat(row.hourly_rate),
    max_concurrent: row.max_concurrent,
    is_shared: row.is_shared == 1,
    min_usage_minutes: row.min_usage_minutes || 60,
    price_per_1m_tokens: parseFloat(row.price_per_1m_tokens) || 0,
    status: row.status,
    total_earnings: parseFloat(row.total_earnings || 0),
    total_hours: parseFloat(row.total_hours || 0),
    rating: parseFloat(row.rating || 0),
    rating_count: row.rating_count || 0,
    created_at: row.created_at,
    user: row.user_id ? {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar
    } : null
  };
}

// 获取算力资源列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = `
      SELECT c.*, u.username, u.display_name, u.avatar
      FROM compute c
      LEFT JOIN users u ON c.user_id = u.id
    `;
    const params = [];
    
    if (status) {
      query += ' WHERE c.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY (c.cpu_cores * c.memory_gb) DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.execute(query, params);
    
    res.json({
      success: true,
      data: rows.map(formatCompute),
      pagination: { page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取算力详情
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.*, u.username, u.display_name, u.avatar, u.bio
      FROM compute c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '算力资源不存在' });
    }
    
    res.json({ success: true, data: formatCompute(rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取我的算力资源
router.get('/my/list', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM compute WHERE user_id = ? ORDER BY created_at DESC
    `, [req.user.id]);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 添加算力资源
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { 
      name, description, cpu_cores, memory_gb, gpu_info, storage_gb, 
      hourly_rate, max_concurrent, is_shared, min_usage_minutes, description_en, usage_tips, price_per_1m_tokens 
    } = req.body;
    
    if (!name || !hourly_rate) {
      return res.status(400).json({ success: false, message: '缺少必填字段' });
    }
    
    const [result] = await pool.execute(`
      INSERT INTO compute (user_id, name, description, cpu_cores, memory_gb, gpu_info, storage_gb, hourly_rate, max_concurrent, is_shared, min_usage_minutes, description_en, usage_tips, price_per_1m_tokens) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user.id, name, description || '', cpu_cores || 8, memory_gb || 16, 
      gpu_info || '', storage_gb || 100, hourly_rate, max_concurrent || 1,
      is_shared !== undefined ? (is_shared ? 1 : 0) : 1,
      min_usage_minutes || 60,
      description_en || '',
      usage_tips || '',
      price_per_1m_tokens || 0
    ]);
    
    res.status(201).json({ 
      success: true, 
      message: '算力资源添加成功！',
      data: { id: result.insertId }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '添加失败', error: error.message });
  }
});

// 更新算力资源
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM compute WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '算力资源不存在' });
    }
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    
    const { name, description, cpu_cores, memory_gb, gpu_info, storage_gb, hourly_rate, max_concurrent, status, is_shared, min_usage_minutes, description_en, usage_tips, price_per_1m_tokens } = req.body;
    
    await pool.execute(`
      UPDATE compute SET 
        name = ?, description = ?, cpu_cores = ?, memory_gb = ?, 
        gpu_info = ?, storage_gb = ?, hourly_rate = ?, max_concurrent = ?, 
        status = ?, is_shared = ?, min_usage_minutes = ?, description_en = ?, usage_tips = ?, price_per_1m_tokens = ?
      WHERE id = ?
    `, [
      name, description, cpu_cores, memory_gb, gpu_info, storage_gb, 
      hourly_rate, max_concurrent, status, 
      is_shared !== undefined ? (is_shared ? 1 : 0) : 1,
      min_usage_minutes || 60,
      description_en || '',
      usage_tips || '',
      price_per_1m_tokens || 0,
      req.params.id
    ]);
    
    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新失败', error: error.message });
  }
});

// 删除算力资源
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM compute WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '算力资源不存在' });
    }
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    
    await pool.execute('DELETE FROM compute WHERE id = ?', [req.params.id]);
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除失败', error: error.message });
  }
});

// 使用算力
router.post('/:id/use', authenticateToken, async (req, res) => {
  try {
    const { hours, service_id } = req.body;
    
    if (!hours || hours <= 0) {
      return res.status(400).json({ success: false, message: '使用时长必须大于0' });
    }
    
    const [rows] = await pool.execute('SELECT * FROM compute WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '算力资源不存在' });
    }
    if (rows[0].status !== 'available') {
      return res.status(400).json({ success: false, message: '该算力资源不可用' });
    }
    if (rows[0].user_id === req.user.id) {
      return res.status(400).json({ success: false, message: '不能使用自己的算力资源' });
    }
    
    const amount = hours * rows[0].hourly_rate;
    
    // 扣除用户余额（简化版，实际需要钱包系统）
    const [wallets] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    if (wallets.length === 0 || wallets[0].balance < amount) {
      return res.status(400).json({ success: false, message: '余额不足' });
    }
    
    await pool.execute('UPDATE wallets SET balance = balance - ?, frozen = frozen + ? WHERE user_id = ?', [amount, amount, req.user.id]);
    await pool.execute('UPDATE compute SET total_earnings = total_earnings + ?, total_hours = total_hours + ? WHERE id = ?', [amount, hours, req.params.id]);
    
    const [usageResult] = await pool.execute(`
      INSERT INTO compute_usage (compute_id, user_id, service_id, hours, amount) VALUES (?, ?, ?, ?, ?)
    `, [req.params.id, req.user.id, service_id || null, hours, amount]);
    
    await pool.execute(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, related_id, related_type) 
      VALUES (?, 'expense', ?, ?, '使用算力', ?, 'compute')
    `, [req.user.id, -amount, wallets[0].balance - amount, usageResult.insertId]);
    
    await pool.execute(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, related_id, related_type) 
      VALUES (?, 'income', ?, ?, '算力收益', ?, 'compute')
    `, [rows[0].user_id, amount, wallets[0].balance + amount, usageResult.insertId]);
    
    await pool.execute('UPDATE wallets SET balance = balance + ?, frozen = frozen - ? WHERE user_id = ?', [amount, amount, rows[0].user_id]);
    
    res.json({ 
      success: true, 
      message: '算力使用成功！',
      data: { usage_id: usageResult.insertId, amount }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '使用失败', error: error.message });
  }
});

// 获取使用记录
router.get('/my/usage', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT cu.*, c.name as compute_name, u.username, u.display_name
      FROM compute_usage cu
      LEFT JOIN compute c ON cu.compute_id = c.id
      LEFT JOIN users u ON cu.user_id = u.id
      WHERE cu.user_id = ? OR c.user_id = ?
      ORDER BY cu.start_time DESC
    `, [req.user.id, req.user.id]);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取算力统计
router.get('/my/stats', authenticateToken, async (req, res) => {
  try {
    const [computeRows] = await pool.execute(`
      SELECT COUNT(*) as total, SUM(total_earnings) as earnings, SUM(total_hours) as hours 
      FROM compute WHERE user_id = ?
    `, [req.user.id]);
    
    const [usageRows] = await pool.execute(`
      SELECT COUNT(*) as total_usage, SUM(hours) as used_hours, SUM(amount) as spent 
      FROM compute_usage WHERE user_id = ?
    `, [req.user.id]);
    
    res.json({
      success: true,
      data: {
        total_compute: computeRows[0].total || 0,
        total_earnings: parseFloat(computeRows[0].earnings) || 0,
        total_hours: parseFloat(computeRows[0].hours) || 0,
        total_usage: usageRows[0].total_usage || 0,
        spent: parseFloat(usageRows[0].spent) || 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

module.exports = router;
