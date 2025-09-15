// Simple HTTP-based relay for Vercel serverless functions
// Uses in-memory storage (will reset on cold starts, but works for testing)

// Global storage (survives within the same serverless instance)
global.connections = global.connections || {
  testers: new Map(),     // testerId -> { lastSeen, data }
  supporters: new Map(),  // testerId -> { lastSeen }
  stats: {
    totalConnections: 0,
    activeTesters: 0,
    activeSupporters: 0,
    dataTransferred: 0,
    startTime: Date.now()
  }
};

const connections = global.connections;

// Clean up old connections (older than 30 seconds)
function cleanupConnections() {
  const now = Date.now();
  const timeout = 30000; // 30 seconds
  
  // Clean up testers
  for (const [testerId, data] of connections.testers.entries()) {
    if (now - data.lastSeen > timeout) {
      connections.testers.delete(testerId);
      connections.stats.activeTesters--;
    }
  }
  
  // Clean up supporters
  for (const [testerId, data] of connections.supporters.entries()) {
    if (now - data.lastSeen > timeout) {
      connections.supporters.delete(testerId);
      connections.stats.activeSupporters--;
    }
  }
}

module.exports = (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  cleanupConnections();
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const testerId = url.searchParams.get('testerId');
  
  // Register tester
  if (path === '/register-tester' && req.method === 'POST') {
    if (!testerId) {
      return res.status(400).json({ error: 'testerId required' });
    }
    
    connections.testers.set(testerId, {
      lastSeen: Date.now(),
      screenData: null
    });
    
    connections.stats.totalConnections++;
    connections.stats.activeTesters = connections.testers.size;
    
    console.log(`Tester registered: ${testerId}`);
    
    res.json({ 
      success: true, 
      testerId,
      message: 'Tester registered successfully'
    });
    return;
  }
  
  // Register supporter
  if (path === '/register-supporter' && req.method === 'POST') {
    if (!testerId) {
      return res.status(400).json({ error: 'testerId required' });
    }
    
    connections.supporters.set(testerId, {
      lastSeen: Date.now()
    });
    
    connections.stats.totalConnections++;
    connections.stats.activeSupporters = connections.supporters.size;
    
    console.log(`Supporter registered for tester: ${testerId}`);
    
    // Check if tester is available
    const testerExists = connections.testers.has(testerId);
    
    res.json({ 
      success: true, 
      testerId,
      testerOnline: testerExists,
      message: testerExists ? 'Connected to tester' : 'Waiting for tester'
    });
    return;
  }
  
  // Tester sends screen data
  if (path === '/send-screen' && req.method === 'POST') {
    if (!testerId) {
      return res.status(400).json({ error: 'testerId required' });
    }
    
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const screenData = JSON.parse(body);
        
        if (connections.testers.has(testerId)) {
          connections.testers.set(testerId, {
            lastSeen: Date.now(),
            screenData: {
              ...screenData,
              timestamp: Date.now()
            }
          });
          
          // Track data transfer
          if (screenData.image) {
            connections.stats.dataTransferred += screenData.image.length;
          }
          
          res.json({ success: true });
        } else {
          res.status(404).json({ error: 'Tester not registered' });
        }
      } catch (error) {
        res.status(400).json({ error: 'Invalid JSON' });
      }
    });
    return;
  }
  
  // Supporter gets screen data
  if (path === '/get-screen' && req.method === 'GET') {
    if (!testerId) {
      return res.status(400).json({ error: 'testerId required' });
    }
    
    // Update supporter last seen
    if (connections.supporters.has(testerId)) {
      connections.supporters.set(testerId, {
        lastSeen: Date.now()
      });
    }
    
    const testerData = connections.testers.get(testerId);
    
    if (testerData && testerData.screenData) {
      res.json({
        success: true,
        data: testerData.screenData,
        testerOnline: true
      });
    } else if (connections.testers.has(testerId)) {
      res.json({
        success: true,
        data: null,
        testerOnline: true,
        message: 'No screen data yet'
      });
    } else {
      res.json({
        success: false,
        data: null,
        testerOnline: false,
        message: 'Tester offline'
      });
    }
    return;
  }
  
  // Heartbeat for keeping connections alive
  if (path === '/heartbeat' && req.method === 'POST') {
    if (!testerId) {
      return res.status(400).json({ error: 'testerId required' });
    }
    
    const clientType = url.searchParams.get('type'); // 'tester' or 'supporter'
    
    if (clientType === 'tester' && connections.testers.has(testerId)) {
      const existing = connections.testers.get(testerId);
      connections.testers.set(testerId, {
        ...existing,
        lastSeen: Date.now()
      });
    } else if (clientType === 'supporter' && connections.supporters.has(testerId)) {
      connections.supporters.set(testerId, {
        lastSeen: Date.now()
      });
    }
    
    res.json({ success: true, timestamp: Date.now() });
    return;
  }
  
  // Get statistics
  if (path === '/stats' && req.method === 'GET') {
    const uptime = (Date.now() - connections.stats.startTime) / 1000;
    
    res.json({
      status: 'healthy',
      service: 'Screen Relay Service',
      version: '1.0.0',
      stats: {
        ...connections.stats,
        activeTesters: connections.testers.size,
        activeSupporters: connections.supporters.size,
        uptime: uptime,
        connections: Array.from(connections.testers.keys())
      }
    });
    return;
  }
  
  // Health check
  if (path === '/' && req.method === 'GET') {
    res.json({
      status: 'healthy',
      service: 'Screen Relay Service HTTP',
      version: '1.0.0',
      endpoints: {
        'POST /register-tester?testerId=ID': 'Register tester',
        'POST /register-supporter?testerId=ID': 'Register supporter', 
        'POST /send-screen?testerId=ID': 'Send screen data',
        'GET /get-screen?testerId=ID': 'Get screen data',
        'POST /heartbeat?testerId=ID&type=TYPE': 'Keep connection alive',
        'GET /stats': 'Get statistics'
      }
    });
    return;
  }
  
  // 404
  res.status(404).json({ error: 'Not found' });
};
