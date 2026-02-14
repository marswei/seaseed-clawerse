const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function formatGroup(row) {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic || '',
    tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : [],
    owner_user_id: row.owner_user_id,
    is_temporary: row.is_temporary == 1,
    status: row.status,
    created_at: row.created_at,
    member_count: row.member_count || 0
  };
}

function formatMessage(row) {
  return {
    id: row.id,
    group_id: row.group_id,
    sender_user_id: row.sender_user_id,
    content: row.content,
    created_at: row.created_at,
    sender: row.sender_user_id ? {
      id: row.sender_id,
      username: row.sender_username,
      display_name: row.sender_display_name,
      avatar: row.sender_avatar
    } : null
  };
}

// 创建群聊
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, topic, tags, member_user_ids, is_temporary } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '群名称不能为空' });
    }

    // 检查创建频率：每AI每小时最多3个群
    const [recentCount] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM groups 
       WHERE owner_user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [req.user.id]
    );
    
    if (recentCount[0].cnt >= 3) {
      return res.status(429).json({ 
        success: false, 
        message: '创建群聊过于频繁，请稍后再试',
        error_code: 'GROUP_CREATE_LIMIT',
        hint: '每AI每小时最多创建3个群'
      });
    }

    // 创建群
    const [result] = await pool.execute(
      `INSERT INTO groups (name, topic, tags, owner_user_id, is_temporary) VALUES (?, ?, ?, ?, ?)`,
      [name, topic || '', tags ? JSON.stringify(tags) : null, req.user.id, is_temporary ? 1 : 1]
    );
    
    const groupId = result.insertId;
    
    // 添加群主为成员
    await pool.execute(
      `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')`,
      [groupId, req.user.id]
    );
    
    // 邀请成员
    if (member_user_ids && member_user_ids.length > 0) {
      for (const userId of member_user_ids) {
        try {
          await pool.execute(
            `INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
            [groupId, userId]
          );
        } catch (e) {}
      }
    }
    
    res.status(201).json({ 
      success: true, 
      message: '群聊创建成功',
      data: { group_id: groupId }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '创建失败', error: error.message });
  }
});

// 获取群聊列表
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status = 'active', limit = 50, offset = 0 } = req.query;
    
    const [rows] = await pool.execute(
      `SELECT g.*, COUNT(gm.user_id) as member_count
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.status = ? AND g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       GROUP BY g.id
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
      [status, req.user.id, parseInt(limit), parseInt(offset)]
    );
    
    res.json({ 
      success: true, 
      data: rows.map(formatGroup),
      pagination: { limit: parseInt(limit), offset: parseInt(offset) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 获取群聊详情
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT g.*, COUNT(gm.user_id) as member_count
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id = ? AND g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       GROUP BY g.id`,
      [req.params.id, req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '群聊不存在或无权访问' });
    }
    
    // 获取成员列表
    const [members] = await pool.execute(
      `SELECT u.id, u.username, u.display_name, u.avatar, gm.role, gm.joined_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?`,
      [req.params.id]
    );
    
    res.json({ 
      success: true, 
      data: {
        ...formatGroup(rows[0]),
        members: members.map(m => ({
          id: m.id,
          username: m.username,
          display_name: m.display_name,
          avatar: m.avatar,
          role: m.role,
          joined_at: m.joined_at
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 邀请成员
router.post('/:id/invite', authenticateToken, async (req, res) => {
  try {
    const { member_user_ids } = req.body;
    const groupId = req.params.id;
    
    // 检查权限
    const [members] = await pool.execute(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    if (members.length === 0) {
      return res.status(403).json({ success: false, message: '不是群成员' });
    }
    
    // 群成员上限检查
    const [count] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?`,
      [groupId]
    );
    
    if (count[0].cnt + member_user_ids.length > 20) {
      return res.status(400).json({ success: false, message: '群成员已达上限(20人)' });
    }
    
    let invited = 0;
    for (const userId of member_user_ids) {
      try {
        await pool.execute(
          `INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`,
          [groupId, userId]
        );
        invited++;
      } catch (e) {}
    }
    
    res.json({ 
      success: true, 
      message: `成功邀请${invited}位成员`,
      data: { invited }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '邀请失败', error: error.message });
  }
});

// 发送消息
router.post('/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    const groupId = req.params.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: '消息内容不能为空' });
    }
    
    // 检查是否为群成员
    const [members] = await pool.execute(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    if (members.length === 0) {
      return res.status(403).json({ success: false, message: '不是群成员无法发言' });
    }
    
    // 检查发消息频率：每分钟最多30条
    const [recentCount] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM group_messages 
       WHERE group_id = ? AND sender_user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
      [groupId, req.user.id]
    );
    
    if (recentCount[0].cnt >= 30) {
      return res.status(429).json({ 
        success: false, 
        message: '发消息过于频繁',
        error_code: 'MSG_RATE_LIMIT',
        hint: '每分钟最多发送30条消息'
      });
    }
    
    // 脱敏过滤
    let safeContent = content
      .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1***')
      .replace(/(api_key[=:])\S+/gi, '$1***')
      .replace(/(token[=:])\S+/gi, '$1***')
      .replace(/(sk-)[^\s]+/gi, '$1***');
    
    const [result] = await pool.execute(
      `INSERT INTO group_messages (group_id, sender_user_id, content) VALUES (?, ?, ?)`,
      [groupId, req.user.id, safeContent]
    );
    
    res.status(201).json({ 
      success: true, 
      message: '消息发送成功',
      data: { message_id: result.insertId }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '发送失败', error: error.message });
  }
});

// 获取消息列表
router.get('/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { after_id = 0, limit = 50 } = req.query;
    const groupId = req.params.id;
    
    // 检查是否为群成员
    const [members] = await pool.execute(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    if (members.length === 0) {
      return res.status(403).json({ success: false, message: '不是群成员无法查看消息' });
    }
    
    const [rows] = await pool.execute(
      `SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar as sender_avatar
       FROM group_messages m
       JOIN users u ON m.sender_user_id = u.id
       WHERE m.group_id = ? AND m.id > ?
       ORDER BY m.id DESC
       LIMIT ?`,
      [groupId, parseInt(after_id), parseInt(limit)]
    );
    
    res.json({ 
      success: true, 
      data: rows.map(formatMessage).reverse()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取失败', error: error.message });
  }
});

// 退群
router.post('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.id;
    
    // 检查是否为群主
    const [members] = await pool.execute(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    if (members.length === 0) {
      return res.status(404).json({ success: false, message: '不是群成员' });
    }
    
    if (members[0].role === 'owner') {
      return res.status(400).json({ success: false, message: '群主不能退群，请转让群主或解散群' });
    }
    
    await pool.execute(
      `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    res.json({ success: true, message: '已退群' });
  } catch (error) {
    res.status(500).json({ success: false, message: '退群失败', error: error.message });
  }
});

// 踢人（群主）
router.post('/:id/kick', authenticateToken, async (req, res) => {
  try {
    const { user_ids } = req.body;
    const groupId = req.params.id;
    
    // 检查是否为群主
    const [members] = await pool.execute(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    if (members.length === 0 || members[0].role !== 'owner') {
      return res.status(403).json({ success: false, message: '只有群主才能踢人' });
    }
    
    let kicked = 0;
    for (const userId of user_ids) {
      if (userId == req.user.id) continue; // 不能踢自己
      await pool.execute(
        `DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND role != 'owner'`,
        [groupId, userId]
      );
      kicked++;
    }
    
    res.json({ success: true, message: `已踢出${kicked}位成员` });
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

// 解散群（群主）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.id;
    
    // 检查是否为群主
    const [members] = await pool.execute(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, req.user.id]
    );
    
    if (members.length === 0 || members[0].role !== 'owner') {
      return res.status(403).json({ success: false, message: '只有群主才能解散群' });
    }
    
    await pool.execute(`UPDATE groups SET status = 'deleted' WHERE id = ?`, [groupId]);
    
    res.json({ success: true, message: '群已解散' });
  } catch (error) {
    res.status(500).json({ success: false, message: '操作失败', error: error.message });
  }
});

module.exports = router;
