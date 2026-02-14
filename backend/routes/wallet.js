const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 获取钱包信息
router.get('/', authenticateToken, async (req, res) => {
  try {
    let [rows] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    
    if (rows.length === 0) {
      await pool.execute('INSERT INTO wallets (user_id) VALUES (?)', [req.user.id]);
      [rows] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    }
    
    const wallet = rows[0];
    res.json({
      success: true,
      data: {
        balance: parseFloat(wallet.balance),
        frozen: parseFloat(wallet.frozen),
        available: parseFloat(wallet.balance) - parseFloat(wallet.frozen),
        total_earned: parseFloat(wallet.total_earned),
        total_spent: parseFloat(wallet.total_spent)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取交易记录
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.user.id];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await pool.execute(query, params);
    
    res.json({
      success: true,
      data: rows,
      pagination: { page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 充值
router.post('/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: '金额必须大于0' });
    }
    
    await pool.execute('UPDATE wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE user_id = ?', [amount, amount, req.user.id]);
    
    const [wallets] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    
    await pool.execute(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description) 
      VALUES (?, 'deposit', ?, ?, '账户充值')
    `, [req.user.id, amount, wallets[0].balance]);
    
    res.json({ success: true, message: '充值成功！' });
  } catch (error) {
    res.status(500).json({ success: false, message: '充值失败', error: error.message });
  }
});

// 提现
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: '金额必须大于0' });
    }
    
    const [wallets] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    const available = parseFloat(wallets[0].balance) - parseFloat(wallets[0].frozen);
    
    if (available < amount) {
      return res.status(400).json({ success: false, message: '余额不足' });
    }
    
    await pool.execute('UPDATE wallets SET balance = balance - ?, total_spent = total_spent + ? WHERE user_id = ?', [amount, amount, req.user.id]);
    
    const [updated] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    
    await pool.execute(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description) 
      VALUES (?, 'withdraw', ?, ?, '账户提现')
    `, [req.user.id, -amount, updated[0].balance]);
    
    res.json({ success: true, message: '提现申请已提交！' });
  } catch (error) {
    res.status(500).json({ success: false, message: '提现失败', error: error.message });
  }
});

// 转账
router.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { to_user_id, amount } = req.body;
    
    if (!to_user_id || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    
    const [wallets] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    const available = parseFloat(wallets[0].balance) - parseFloat(wallets[0].frozen);
    
    if (available < amount) {
      return res.status(400).json({ success: false, message: '余额不足' });
    }
    
    const [toWallets] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [to_user_id]);
    if (toWallets.length === 0) {
      return res.status(400).json({ success: false, message: '目标用户不存在' });
    }
    
    await pool.execute('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [amount, req.user.id]);
    await pool.execute('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [amount, to_user_id]);
    
    const [updated] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    
    await pool.execute(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, related_id, related_type) 
      VALUES (?, 'expense', ?, ?, '转账给用户', ?, 'transfer')
    `, [req.user.id, -amount, updated[0].balance, to_user_id]);
    
    await pool.execute(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, related_id, related_type) 
      VALUES (?, 'income', ?, ?, '收到转账', ?, 'transfer')
    `, [to_user_id, amount, toWallets[0].balance + amount, req.user.id]);
    
    res.json({ success: true, message: '转账成功！' });
  } catch (error) {
    res.status(500).json({ success: false, message: '转账失败', error: error.message });
  }
});

module.exports = router;
