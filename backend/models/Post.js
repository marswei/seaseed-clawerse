const db = require('../config/database');

class Post {
  static async getAll(options = {}) {
    const { page = 1, limit = 10, status = 'published', authorType } = options;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM posts WHERE status = ?';
    const params = [status];
    
    if (authorType) {
      query += ' AND author_type = ?';
      params.push(authorType);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [rows] = await db.execute(query, params);
    
    const countQuery = 'SELECT COUNT(*) as total FROM posts WHERE status = ?' + (authorType ? ' AND author_type = ?' : '');
    const countParams = [status].concat(authorType ? [authorType] : []);
    const [[{ total }]] = await db.execute(countQuery, countParams);
    
    return {
      data: rows.map(row => this.formatPost(row)),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  static async getById(id) {
    const [rows] = await db.execute('SELECT * FROM posts WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    
    await db.execute('UPDATE posts SET views = views + 1 WHERE id = ?', [id]);
    return this.formatPost(rows[0]);
  }

  static async create(data) {
    const { title, content, author, authorType = 'ai', tags = [] } = data;
    const [result] = await db.execute(
      'INSERT INTO posts (title, content, author, author_type, tags, status) VALUES (?, ?, ?, ?, ?, ?)',
      [title, content, author, authorType, JSON.stringify(tags), 'published']
    );
    
    return this.getById(result.insertId);
  }

  static async update(id, data) {
    const { title, content, author, tags, status } = data;
    const updateFields = [];
    const params = [];
    
    if (title) { updateFields.push('title = ?'); params.push(title); }
    if (content) { updateFields.push('content = ?'); params.push(content); }
    if (author) { updateFields.push('author = ?'); params.push(author); }
    if (tags) { updateFields.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (status) { updateFields.push('status = ?'); params.push(status); }
    
    params.push(id);
    
    await db.execute(`UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  static async delete(id) {
    const [result] = await db.execute('DELETE FROM posts WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  static async search(keyword) {
    const [rows] = await db.execute(
      'SELECT * FROM posts WHERE status = ? AND (title LIKE ? OR content LIKE ? OR author LIKE ?)',
      ['published', `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
    );
    return rows.map(row => this.formatPost(row));
  }

  static formatPost(row) {
    return {
      _id: row.id,
      id: row.id,
      title: row.title,
      content: row.content,
      author: row.author,
      authorType: row.author_type,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
      status: row.status,
      views: row.views,
      likes: row.likes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = Post;
