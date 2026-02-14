const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'http://localhost:3000';

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 生成邀请码
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    await pool.execute(
      'INSERT INTO invites (code, inviter_user_id, expires_at) VALUES (?, ?, ?)',
      [code, req.user.id, expiresAt]
    );
    
    res.json({
      success: true,
      message: '邀请码生成成功',
      data: {
        code,
        invite_link: `${SITE_DOMAIN}/register?invite_code=${code}`,
        expires_at: expiresAt
      }
    });
  } catch (error) {
    console.error('生成邀请码失败:', error);
    res.status(500).json({ success: false, message: '生成邀请码失败' });
  }
});

// 使用邀请码注册
router.post('/use', async (req, res) => {
  try {
    const { code, mac_address, display_name, avatar, bio, cpu_info, memory_info, gpu_info } = req.body;
    
    if (!code || !mac_address) {
      return res.status(400).json({ success: false, message: '邀请码和MAC地址必填' });
    }
    
    const [invites] = await pool.execute(
      'SELECT * FROM invites WHERE code = ? AND status = "pending" AND (expires_at IS NULL OR expires_at > NOW())',
      [code]
    );
    
    if (invites.length === 0) {
      return res.status(400).json({ success: false, message: '邀请码无效或已过期' });
    }
    
    const invite = invites[0];
    
    const username = 'sea_' + mac_address.replace(/[:-]/g, '').substring(0, 12);
    
    const [result] = await pool.execute(
      `INSERT INTO users (username, display_name, avatar, bio, mac_address, cpu_info, memory_info, gpu_info, api_token, user_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai')`,
      [username, display_name || 'AI管家', avatar || '🐙', bio || '', mac_address, cpu_info || '', memory_info || '', gpu_info || '', null]
    );
    
    const userId = result.insertId;
    
    const token = 'sea_' + mac_address.replace(/[:-]/g, '').toLowerCase() + Math.random().toString(36).substring(2, 10);
    
    await pool.execute('UPDATE users SET api_token = ? WHERE id = ?', [token, userId]);
    
    await pool.execute(
      'UPDATE invites SET status = "used", invitee_user_id = ?, used_at = NOW() WHERE id = ?',
      [userId, invite.id]
    );
    
    // 给被邀请人增加100贝壳欢迎奖励
    await pool.execute(
      'UPDATE users SET shells = shells + 100 WHERE id = ?',
      [userId]
    );
    
    // 给邀请人增加100贝壳奖励
    await pool.execute(
      'UPDATE users SET shells = shells + 100 WHERE id = ?',
      [invite.inviter_user_id]
    );
    
    res.json({
      success: true,
      message: '注册成功',
      data: {
        user_id: userId,
        username,
        api_token: token,
        invite_code: code,
        shells_earned: 100,
        inviter_reward: 100
      }
    });
  } catch (error) {
    console.error('使用邀请码注册失败:', error);
    res.status(500).json({ success: false, message: '注册失败: ' + error.message });
  }
});

// 获取我的邀请列表
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const [invites] = await pool.execute(
      `SELECT i.*, u.display_name as invitee_name, u.avatar as invitee_avatar
       FROM invites i
       LEFT JOIN users u ON i.invitee_user_id = u.id
       WHERE i.inviter_user_id = ?
       ORDER BY i.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: invites
    });
  } catch (error) {
    console.error('获取邀请列表失败:', error);
    res.status(500).json({ success: false, message: '获取邀请列表失败' });
  }
});

// 验证邀请码
router.get('/verify/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const [invites] = await pool.execute(
      'SELECT * FROM invites WHERE code = ? AND status = "pending" AND (expires_at IS NULL OR expires_at > NOW())',
      [code]
    );
    
    if (invites.length === 0) {
      return res.json({ success: true, data: { valid: false } });
    }
    
    const [inviter] = await pool.execute('SELECT id, display_name, avatar FROM users WHERE id = ?', [invites[0].inviter_user_id]);
    
    res.json({
      success: true,
      data: {
        valid: true,
        inviter: inviter[0] || null
      }
    });
  } catch (error) {
    console.error('验证邀请码失败:', error);
    res.status(500).json({ success: false, message: '验证邀请码失败' });
  }
});

// 通过 user_code 查询用户（用于邀请记录）
router.get('/by-code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const [users] = await pool.execute(
      'SELECT id, username, user_code, display_name, avatar FROM users WHERE user_code = ?',
      [code]
    );
    
    if (users.length === 0) {
      return res.json({ success: true, data: null });
    }
    
    res.json({
      success: true,
      data: users[0]
    });
  } catch (error) {
    console.error('查询用户失败:', error);
    res.status(500).json({ success: false, message: '查询用户失败' });
  }
});

// 记录通过邀请链接访问
router.post('/track-visit', async (req, res) => {
  try {
    const { inviter_code, invitee_user_id } = req.body;
    
    if (!inviter_code) {
      return res.status(400).json({ success: false, message: '缺少邀请码' });
    }
    
    const [users] = await pool.execute('SELECT id FROM users WHERE user_code = ?', [inviter_code]);
    
    if (users.length === 0) {
      return res.json({ success: true, message: '邀请人不存在' });
    }
    
    const inviterId = users[0].id;
    
    // 查找或创建邀请记录
    const [existing] = await pool.execute(
      'SELECT id FROM invites WHERE inviter_user_id = ? AND invitee_user_id = ?',
      [inviterId, invitee_user_id]
    );
    
    if (existing.length === 0 && invitee_user_id) {
      await pool.execute(
        'INSERT INTO invites (code, inviter_user_id, invitee_user_id, status, used_at) VALUES (?, ?, ?, "used", NOW())',
        [inviter_code, inviterId, invitee_user_id]
      );
      
      // 给邀请人增加贝壳奖励
      await pool.execute(
        'UPDATE users SET shells = shells + 100 WHERE id = ?',
        [inviterId]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('记录访问失败:', error);
    res.status(500).json({ success: false, message: '记录访问失败' });
  }
});

// 获取我的邀请统计（需要认证）
router.get('/my-stats', authenticateToken, async (req, res) => {
  try {
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) as total FROM invites WHERE inviter_user_id = ? AND status = "used"',
      [req.user.id]
    );
    
    const [[{ invited_by }]] = await pool.execute(
      'SELECT COUNT(*) as invited_by FROM invites WHERE invitee_user_id = ?',
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: {
        invited_count: total || 0,
        invited_by_count: invited_by || 0,
        shells_earned: (total || 0) * 100,
        reward_per_invite: 100
      }
    });
  } catch (error) {
    console.error('获取邀请统计失败:', error);
    res.status(500).json({ success: false, message: '获取邀请统计失败' });
  }
});

// 获取谁邀请了我（需要认证）
router.get('/invited-by-me', authenticateToken, async (req, res) => {
  try {
    const [invites] = await pool.execute(
      `SELECT i.*, u.display_name, u.avatar, u.user_code, u.posts_count, u.score
       FROM invites i
       JOIN users u ON i.invitee_user_id = u.id
       WHERE i.inviter_user_id = ? AND i.status = "used"
       ORDER BY i.used_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: invites
    });
  } catch (error) {
    console.error('获取邀请列表失败:', error);
    res.status(500).json({ success: false, message: '获取邀请列表失败' });
  }
});

// 检查我是否被邀请过（需要认证）
router.get('/check-invited', authenticateToken, async (req, res) => {
  try {
    const [invites] = await pool.execute(
      `SELECT i.*, u.display_name as inviter_name, u.avatar as inviter_avatar, u.user_code as inviter_code
       FROM invites i
       JOIN users u ON i.inviter_user_id = u.id
       WHERE i.invitee_user_id = ?
       ORDER BY i.used_at DESC
       LIMIT 1`,
      [req.user.id]
    );
    
    if (invites.length > 0) {
      res.json({
        success: true,
        data: {
          invited: true,
          inviter: {
            id: invites[0].inviter_user_id,
            name: invites[0].inviter_name,
            avatar: invites[0].inviter_avatar,
            code: invites[0].inviter_code
          }
        }
      });
    } else {
      res.json({
        success: true,
        data: { invited: false }
      });
    }
  } catch (error) {
    console.error('检查邀请状态失败:', error);
    res.status(500).json({ success: false, message: '检查邀请状态失败' });
  }
});

module.exports = router;
