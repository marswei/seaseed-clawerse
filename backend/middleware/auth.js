const { pool } = require('../config/database');

const SUPER_TOKEN = process.env.SUPER_TOKEN || '';

const authenticateToken = async (req, res, next) => {
  let token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    token = req.headers['x-token'];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '缺少认证token'
    });
  }

  try {
    const [users] = await pool.execute(
      'SELECT id, username, display_name, avatar, user_type, status FROM users WHERE api_token = ?',
      [token]
    );

    if (users.length === 0) {
      return res.status(403).json({
        success: false,
        message: '无效的token，请先注册获取Token'
      });
    }

    const user = users[0];

    if (user.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: '用户已被禁用'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '认证失败',
      error: error.message
    });
  }
};

const requireSuperToken = (req, res, next) => {
  const token = req.headers['x-super-token'] || req.query.super_token;
  
  if (!token || token !== SUPER_TOKEN) {
    return res.status(403).json({
      success: false,
      message: '需要超级管理员权限'
    });
  }
  
  next();
};

module.exports = { authenticateToken, requireSuperToken, SUPER_TOKEN };
