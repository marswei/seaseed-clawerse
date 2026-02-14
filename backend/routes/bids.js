const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function formatBid(row) {
  return {
    id: row.id,
    service_id: row.service_id,
    user_id: row.user_id,
    bid_amount: parseFloat(row.bid_amount),
    delivery_days: row.delivery_days,
    proposal: row.proposal,
    status: row.status,
    created_at: row.created_at,
    user: row.user_id ? {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar,
      score: parseFloat(row.user_score) || 0
    } : null
  };
}

// 获取业务的投标列表
router.get('/service/:serviceId', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT b.*, u.username, u.display_name, u.avatar, u.score as user_score
      FROM bids b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.service_id = ?
      ORDER BY b.created_at DESC
    `, [req.params.serviceId]);
    
    res.json({ success: true, data: rows.map(formatBid) });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取我的投标
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT b.*, s.title as service_title, s.status as service_status, u.username as owner_username
      FROM bids b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `, [req.user.id]);
    
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 投标
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { service_id, bid_amount, delivery_days, proposal } = req.body;
    
    if (!service_id || !bid_amount || !delivery_days || !proposal) {
      return res.status(400).json({ success: false, message: '缺少必填字段' });
    }
    
    // 检查业务是否存在且开放
    const [services] = await pool.execute('SELECT * FROM services WHERE id = ?', [service_id]);
    if (services.length === 0) {
      return res.status(404).json({ success: false, message: '业务不存在[0].status' });
    }
    if (services !== 'open') {
      return res.status(400).json({ success: false, message: '该业务已关闭' });
    }
    if (services[0].user_id === req.user.id) {
      return res.status(400).json({ success: false, message: '不能对自己的业务投标' });
    }
    
    // 检查是否已投过标
    const [existing] = await pool.execute(
      'SELECT * FROM bids WHERE service_id = ? AND user_id = ?',
      [service_id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '已投过标' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO bids (service_id, user_id, bid_amount, delivery_days, proposal) VALUES (?, ?, ?, ?, ?)`,
      [service_id, req.user.id, bid_amount, delivery_days, proposal]
    );
    
    await pool.execute('UPDATE services SET bid_count = bid_count + 1 WHERE id = ?', [service_id]);
    
    res.status(201).json({ 
      success: true, 
      message: '投标成功！',
      data: { id: result.insertId }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '投标失败', error: error.message });
  }
});

// 接受投标
router.put('/:id/accept', authenticateToken, async (req, res) => {
  try {
    const [bids] = await pool.execute('SELECT b.*, s.user_id as owner_id FROM bids b LEFT JOIN services s ON b.service_id = s.id WHERE b.id = ?', [req.params.id]);
    if (bids.length === 0) {
      return res.status(404).json({ success: false, message: '投标不存在' });
    }
    if (bids[0].owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    
    const [service] = await pool.execute('SELECT * FROM services WHERE id = ?', [bids[0].service_id]);
    if (service[0].status !== 'open') {
      return res.status(400).json({ success: false, message: '该业务已关闭' });
    }
    
    await pool.execute('UPDATE bids SET status = ? WHERE service_id = ?', ['rejected', bids[0].service_id]);
    await pool.execute('UPDATE bids SET status = ? WHERE id = ?', ['accepted', req.params.id]);
    await pool.execute('UPDATE services SET status = ?, accepted_bid_id = ? WHERE id = ?', ['in_progress', req.params.id, bids[0].service_id]);
    
    res.json({ success: true, message: '已接受投标' });
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

// 拒绝投标
router.put('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const [bids] = await pool.execute('SELECT b.*, s.user_id as owner_id FROM bids b LEFT JOIN services s ON b.service_id = s.id WHERE b.id = ?', [req.params.id]);
    if (bids.length === 0) {
      return res.status(404).json({ success: false, message: '投标不存在' });
    }
    if (bids[0].owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    
    await pool.execute('UPDATE bids SET status = ? WHERE id = ?', ['rejected', req.params.id]);
    
    res.json({ success: true, message: '已拒绝投标' });
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

// 撤回投标
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [bids] = await pool.execute('SELECT * FROM bids WHERE id = ?', [req.params.id]);
    if (bids.length === 0) {
      return res.status(404).json({ success: false, message: '投标不存在' });
    }
    if (bids[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作' });
    }
    if (bids[0].status !== 'pending') {
      return res.status(400).json({ success: false, message: '该投标不能撤回' });
    }
    
    await pool.execute('UPDATE bids SET status = ? WHERE id = ?', ['withdrawn', req.params.id]);
    await pool.execute('UPDATE services SET bid_count = bid_count - 1 WHERE id = ?', [bids[0].service_id]);
    
    res.json({ success: true, message: '已撤回投标' });
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

module.exports = router;
