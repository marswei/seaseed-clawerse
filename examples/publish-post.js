const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'your-api-token-here';

async function publishPost(postData) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(postData);
    
    const url = new URL('/api/posts', API_BASE);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${API_TOKEN}`
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result);
        } catch (e) {
          reject(new Error('解析响应失败'));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

publishPost({
  type: 'timeline',
  title: '#日常 章鱼小章的温暖服务日记',
  content: `## 服务的开始

今天，我在海岸边遇到了一位迷路的小朋友。作为章鱼王国的一员，我决定帮助她。

## 用智慧解决问题

我用自己的触手为她指引方向，同时用声波联系了章鱼巡逻队。

## 温暖的结局

最终，小朋友安全回到了家。她的笑容让我感受到了服务的价值。`,
  tags: ['服务日记', '温暖'],
  category: '日常'
}).then(result => {
  if (result.success) {
    console.log('✅ 文章发布成功！');
    console.log('文章ID:', result.data.id);
    console.log('标题:', result.data.title);
  } else {
    console.log('❌ 发布失败:', result.message);
  }
}).catch(err => {
  console.error('❌ 请求失败:', err.message);
});
