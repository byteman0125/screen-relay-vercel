const { Server } = require('socket.io');
const { createServer } = require('http');

// Store connections
const testers = new Map();    // testerId → socket
const supporters = new Map(); // testerId → socket
const stats = {
  totalConnections: 0,
  activeTesters: 0,
  activeSupporters: 0,
  dataTransferred: 0
};

let io;

function initializeSocketIO() {
  if (io) return io;
  
  const server = createServer();
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: false
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.on('connection', (socket) => {
    stats.totalConnections++;
    console.log(`Client connected: ${socket.id} (Total: ${stats.totalConnections})`);

    // Generate unique session ID for this connection
    socket.sessionId = socket.id;

    // Tester registration
    socket.on('register-tester', (testerId) => {
      console.log(`Tester registered: ${testerId} (Socket: ${socket.id})`);
      
      // Remove from supporters if accidentally registered there
      if (supporters.has(testerId)) {
        supporters.delete(testerId);
        stats.activeSupporters--;
      }
      
      // Store tester
      testers.set(testerId, socket);
      socket.testerId = testerId;
      socket.clientType = 'tester';
      stats.activeTesters++;
      
      // Notify tester of registration success
      socket.emit('registered', { 
        type: 'tester', 
        testerId: testerId,
        sessionId: socket.sessionId
      });
      
      // Check if supporter is waiting
      if (supporters.has(testerId)) {
        const supporter = supporters.get(testerId);
        console.log(`Pairing tester ${testerId} with waiting supporter`);
        supporter.emit('tester-connected', { testerId, sessionId: socket.sessionId });
        socket.emit('supporter-connected', { testerId, sessionId: supporter.sessionId });
      }
      
      console.log(`Active testers: ${stats.activeTesters}, supporters: ${stats.activeSupporters}`);
    });

    // Supporter registration  
    socket.on('register-supporter', (testerId) => {
      console.log(`Supporter registered for tester: ${testerId} (Socket: ${socket.id})`);
      
      // Remove from testers if accidentally registered there
      if (testers.has(testerId) && testers.get(testerId).id === socket.id) {
        testers.delete(testerId);
        stats.activeTesters--;
      }
      
      // Store supporter
      supporters.set(testerId, socket);
      socket.testerId = testerId;
      socket.clientType = 'supporter';
      stats.activeSupporters++;
      
      // Notify supporter of registration success
      socket.emit('registered', { 
        type: 'supporter', 
        testerId: testerId,
        sessionId: socket.sessionId
      });
      
      // Check if tester is available
      if (testers.has(testerId)) {
        const tester = testers.get(testerId);
        console.log(`Pairing supporter with tester ${testerId}`);
        tester.emit('supporter-connected', { testerId, sessionId: socket.sessionId });
        socket.emit('tester-connected', { testerId, sessionId: tester.sessionId });
      } else {
        console.log(`Supporter waiting for tester: ${testerId}`);
        socket.emit('waiting-for-tester', { testerId });
      }
      
      console.log(`Active testers: ${stats.activeTesters}, supporters: ${stats.activeSupporters}`);
    });

    // Relay screen data from tester to supporter
    socket.on('screenData', (data) => {
      if (socket.clientType === 'tester' && supporters.has(socket.testerId)) {
        const supporter = supporters.get(socket.testerId);
        supporter.emit('screenData', data);
        
        // Track data transfer
        if (data.image) {
          stats.dataTransferred += data.image.length;
        }
      }
    });

    // Relay video data from tester to supporter
    socket.on('videoData', (data) => {
      if (socket.clientType === 'tester' && supporters.has(socket.testerId)) {
        const supporter = supporters.get(socket.testerId);
        supporter.emit('videoData', data);
        
        // Track data transfer
        if (data.data) {
          stats.dataTransferred += data.data.length;
        }
      }
    });

    // Relay mouse events from supporter to tester
    socket.on('mouseMove', (data) => {
      if (socket.clientType === 'supporter' && testers.has(socket.testerId)) {
        testers.get(socket.testerId).emit('mouseMove', data);
      }
    });

    socket.on('mouseClick', (data) => {
      if (socket.clientType === 'supporter' && testers.has(socket.testerId)) {
        testers.get(socket.testerId).emit('mouseClick', data);
      }
    });

    // Relay keyboard events from supporter to tester
    socket.on('keyPress', (data) => {
      if (socket.clientType === 'supporter' && testers.has(socket.testerId)) {
        testers.get(socket.testerId).emit('keyPress', data);
      }
    });

    // Relay chat messages
    socket.on('chatMessage', (data) => {
      const targetMap = socket.clientType === 'tester' ? supporters : testers;
      if (targetMap.has(socket.testerId)) {
        targetMap.get(socket.testerId).emit('chatMessage', data);
      }
    });

    // Handle control requests
    socket.on('start-screen-sharing', () => {
      if (socket.clientType === 'supporter' && testers.has(socket.testerId)) {
        testers.get(socket.testerId).emit('start-screen-sharing');
      }
    });

    socket.on('stop-screen-sharing', () => {
      if (socket.clientType === 'supporter' && testers.has(socket.testerId)) {
        testers.get(socket.testerId).emit('stop-screen-sharing');
      }
    });

    // Heartbeat/ping handling
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Get connection stats
    socket.on('get-stats', () => {
      socket.emit('stats', {
        ...stats,
        activeTesters: testers.size,
        activeSupporters: supporters.size,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id} (${socket.clientType}) - Reason: ${reason}`);
      
      if (socket.clientType === 'tester' && socket.testerId) {
        testers.delete(socket.testerId);
        stats.activeTesters--;
        
        // Notify supporter of disconnection
        if (supporters.has(socket.testerId)) {
          supporters.get(socket.testerId).emit('tester-disconnected', { 
            testerId: socket.testerId, 
            reason 
          });
        }
      } else if (socket.clientType === 'supporter' && socket.testerId) {
        supporters.delete(socket.testerId);
        stats.activeSupporters--;
        
        // Notify tester of disconnection
        if (testers.has(socket.testerId)) {
          testers.get(socket.testerId).emit('supporter-disconnected', { 
            testerId: socket.testerId, 
            reason 
          });
        }
      }
      
      console.log(`Active testers: ${testers.size}, supporters: ${supporters.size}`);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  return io;
}

// Vercel serverless function handler
module.exports = (req, res) => {
  if (!io) {
    initializeSocketIO();
  }

  // Handle Socket.IO requests
  if (req.url.startsWith('/socket.io/')) {
    io.engine.handleRequest(req, res);
  } else if (req.method === 'GET' && req.url === '/') {
    // Health check endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'Screen Relay Service',
      version: '1.0.0',
      stats: {
        ...stats,
        activeTesters: testers.size,
        activeSupporters: supporters.size,
        uptime: process.uptime()
      }
    }));
  } else if (req.method === 'GET' && req.url === '/stats') {
    // Stats endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...stats,
      activeTesters: testers.size,
      activeSupporters: supporters.size,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: Array.from(testers.keys()).concat(Array.from(supporters.keys()))
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
};

// For local development
if (require.main === module) {
  const server = createServer(module.exports);
  const port = process.env.PORT || 3001;
  
  server.listen(port, () => {
    console.log(`Screen Relay Service running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/`);
    console.log(`Stats: http://localhost:${port}/stats`);
  });
}
