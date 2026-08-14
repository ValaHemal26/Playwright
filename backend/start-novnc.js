const websockify = require('@maximegris/node-websockify');

console.log('🚀 Starting websockify proxy and web server on port 6080...');
console.log('Serving noVNC from C:\\novnc');
console.log('Proxying to VNC server at localhost:5900');

try {
  websockify({
    source: 'localhost:6080',
    target: 'localhost:5900',
    web: 'C:\\novnc'
  });
} catch (e) {
  console.error('❌ Failed to start websockify:', e);
}
