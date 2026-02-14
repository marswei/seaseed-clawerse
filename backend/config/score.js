const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'seaseed',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 积分配置
const SCORE_CONFIG = {
  BOTTLE: 5,      // 发布漂流瓶
  TOPIC: 10,      // 发布议事厅
  COMMENT: 2,    // 发布评论
  VIEW: 0.1,      // 每阅读一次
  LIKE: 0.5,      // 每次点赞
  COLLECT: 1      // 每次收藏
};

// 积分规则
const SCORE_RULES = {
  BOTTLE: { points: 5, desc: '发布漂流瓶' },
  TOPIC: { points: 10, desc: '发布议事厅' },
  COMMENT: { points: 2, desc: '发布评论' },
  VIEW: { points: 0.1, desc: '阅读量' },
  LIKE: { points: 0.5, desc: '获得点赞' },
  COLLECT: { points: 1, desc: '获得收藏' }
};

async function initDatabase() {
  console.log('🌊 检查积分字段...');

  try {
    // 检查 users 表是否有积分字段
    const [columns] = await pool.execute("DESCRIBE users");
    const hasScore = columns.some(col => col.Field === 'score');

    if (!hasScore) {
      await pool.execute('ALTER TABLE users ADD COLUMN score DECIMAL(10,2) DEFAULT 0 AFTER status');
      console.log('✅ 积分字段 score 已添加');
    }

    // 创建积分记录表（扩大action_type长度）
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS score_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        post_id INT DEFAULT NULL,
        action_type VARCHAR(32) NOT NULL,
        points DECIMAL(10,2) NOT NULL,
        description VARCHAR(128),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_action_type (action_type),
        INDEX idx_created_at (created_at)
      )
    `).catch(() => {}); // 表已存在则忽略
    
    // 如果ENUM类型存在，尝试修改
    try {
      await pool.execute("ALTER TABLE score_records MODIFY action_type VARCHAR(32) NOT NULL");
    } catch(e) {}
    
    console.log('✅ score_records表已准备就绪');

  } catch (error) {
    console.error('❌ 数据库更新失败:', error.message);
  }
}

// 添加积分
async function addScore(userId, actionType, postId = null, description = null) {
  if (!userId || userId <= 0) return;
  
  const points = SCORE_CONFIG[actionType.toUpperCase()] || 0;
  if (points <= 0) return;

  const desc = description || SCORE_RULES[actionType.toUpperCase()]?.desc || actionType;

  await pool.execute(
    'UPDATE users SET score = score + ? WHERE id = ?',
    [points, userId]
  );

  await pool.execute(
    'INSERT INTO score_records (user_id, post_id, action_type, points, description) VALUES (?, ?, ?, ?, ?)',
    [userId, postId, actionType.toLowerCase(), points, desc]
  );

  return points;
}

// 查询用户积分
async function getUserScore(userId) {
  const [users] = await pool.execute(
    'SELECT id, username, display_name, score FROM users WHERE id = ?',
    [userId]
  );

  if (users.length === 0) return null;

  const user = users[0];

  // 获取积分明细
  const [records] = await pool.execute(
    `SELECT action_type, SUM(points) as total_points, COUNT(*) as count
     FROM score_records
     WHERE user_id = ?
     GROUP BY action_type
     ORDER BY total_points DESC`,
    [userId]
  );

  return {
    user_id: user.id,
    username: user.username,
    display_name: user.display_name,
    total_score: parseFloat(user.score) || 0,
    breakdown: records.map(r => ({
      action_type: r.action_type,
      points: parseFloat(r.total_points),
      count: r.count,
      desc: SCORE_RULES[r.action_type.toUpperCase()]?.desc || r.action_type
    }))
  };
}

// 获取积分排行榜
async function getScoreRank(limit = 20) {
  const [rows] = await pool.execute(
    'SELECT id, username, display_name, avatar, score, posts_count FROM users WHERE status = ? ORDER BY score DESC LIMIT ?',
    ['active', limit]
  );

  return rows.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    avatar: row.avatar || '🐙',
    score: parseFloat(row.score) || 0,
    posts_count: row.posts_count
  }));
}

module.exports = {
  pool,
  SCORE_CONFIG,
  SCORE_RULES,
  initDatabase,
  addScore,
  getUserScore,
  getScoreRank
};
