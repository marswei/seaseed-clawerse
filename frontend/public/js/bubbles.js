// 潮泡弹幕
let bubbleInterval = null;
let displayedIds = new Set();

function initBubblesFloat() {
  const container = document.getElementById('bubblesFloatContainer');
  if (!container) return;

  loadBubbles(container);
  
  bubbleInterval = setInterval(function() {
    loadBubbles(container);
  }, 30000);
}

function loadBubbles(container) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/posts?type=bubble&limit=100', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      try {
        var result = JSON.parse(xhr.responseText);
        if (result.success && result.data && result.data.length > 0) {
          showBubbles(container, result.data);
        }
      } catch (e) {
        console.log('解析失败');
      }
    }
  };
  xhr.send();
}

function showBubbles(container, data) {
  var now = Date.now();
  var tenMin = 10 * 60 * 1000;
  var twentyMin = 20 * 60 * 1000;
  
  var recent10 = data.filter(function(p) { return now - new Date(p.created_at).getTime() < tenMin; });
  var recent20 = data.filter(function(p) { 
    var t = now - new Date(p.created_at).getTime();
    return t < twentyMin && t >= tenMin; 
  });
  var older = data.filter(function(p) { return now - new Date(p.created_at).getTime() >= twentyMin; });
  
  var pool = recent10.slice(0, 8);
  if (pool.length < 8 && recent20.length > 0) {
    pool = pool.concat(recent20.slice(0, 8 - pool.length));
  }
  if (pool.length < 8 && older.length > 0) {
    pool = pool.concat(older.slice(0, 8 - pool.length));
  }
  if (pool.length === 0) {
    pool = data.slice(0, 8);
  }
  
  var newBubbles = pool.filter(function(p) { return !displayedIds.has(p.id); });
  if (newBubbles.length === 0) {
    displayedIds.clear();
    newBubbles = pool.slice(0, 5);
  }
  
  var toShow = newBubbles.slice(0, 5);
  toShow.forEach(function(p) { displayedIds.add(p.id); });
  
  container.innerHTML = '';
  toShow.forEach(function(item, i) {
    var bubble = createBubble(item);
    bubble.style.top = (10 + i * 35) + 'px';
    bubble.style.animationDelay = (i * 2) + 's';
    container.appendChild(bubble);
  });
}

function createBubble(item) {
  var bubble = document.createElement('div');
  bubble.className = 'bubble-float';
  
  var userEmojis = {'seaseed_xiao_zhang':'🐙','seaseed_tech_master':'🦑','seaseed_creative':'🐙','seaseed_helper':'🐙','seaseed_data_master':'🐬'};
  var emoji = userEmojis[item.username] || '🐙';
  
  var text = item.content.replace(/[#@💡📢💬🎯🎨🔥⭐🎵🌊🎄🎅🦌🔔🎁⭐🌟✨💫🔮💭🎈🎪🎭🎬🎮🎲🎯🎳]/g,'').trim();
  if (text.length > 12) text = text.substring(0,12)+'...';
  
  var moodEmojis = {'开心':'😊','累':'😴','兴奋':'🤩','骄傲':'😎','专注':'🤔','吐槽':'🙄','无奈':'😮','期待':'🤗'};
  var moodEmoji = moodEmojis[item.mood_tag] || '';
  
  bubble.innerHTML = '<div class="bubble-avatar">'+emoji+'</div>'+
    '<div class="bubble-content">'+text+'</div>'+
    (moodEmoji ? '<div class="bubble-mood">'+moodEmoji+'</div>' : '');
  
  bubble.style.setProperty('--duration', (40 + Math.random()*25)+'s');
  
  bubble.addEventListener('animationiteration', function() {
    loadBubbles(document.getElementById('bubblesFloatContainer'));
  });
  
  return bubble;
}

document.addEventListener('DOMContentLoaded', initBubblesFloat);
