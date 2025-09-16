const { Server } = require('socket.io');
const { createServer } = require('http');
const express = require('express');
const path = require('path');

// Store connections
const servers = new Map();    // serverId → socket
const viewers = new Map(); // serverId → socket
const stats = {
  totalConnections: 0,
  activeServers: 0,
  activeViewers: 0,
  dataTransferred: 0,
  startTime: Date.now()
};

// Create Express app and HTTP server
const app = express();
const server = createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.get('/stats', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Screen Relay Service',
    version: '1.0.0',
    stats: {
      ...stats,
      activeServers: servers.size,
      activeViewers: viewers.size,
      uptime: (Date.now() - stats.startTime) / 1000,
      memory: process.memoryUsage(),
      connections: Array.from(servers.keys()).concat(Array.from(viewers.keys()))
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize Socket.IO optimized for high-quality screen sharing
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ['websocket'],        // WebSocket only for best performance
  allowEIO3: true,
  pingTimeout: 60000,               // Longer timeout for high-quality frames
  pingInterval: 25000,              // Standard ping interval for stability
  maxHttpBufferSize: 2e8,          // 200MB buffer for 1080p frames
  compression: true,                // Enable compression for large frames
  perMessageDeflate: true,          // Enable per-message compression
  httpCompression: true,            // Enable HTTP compression
  cookie: false                     // Disable cookies for speed
});

  io.on('connection', (socket) => {
    stats.totalConnections++;
    console.log(`Client connected: ${socket.id} (Total: ${stats.totalConnections})`);

    // Generate unique session ID for this connection
    socket.sessionId = socket.id;

    // Server registration
    socket.on('register-server', (serverId) => {
      console.log(`Server registered: ${serverId} (Socket: ${socket.id})`);
      
      // Remove from viewers if accidentally registered there
      if (viewers.has(serverId)) {
        viewers.delete(serverId);
        stats.activeViewers--;
      }
      
      // Store server
      servers.set(serverId, socket);
      socket.serverId = serverId;
      socket.clientType = 'server';
      stats.activeServers++;
      
      // Notify server of registration success
      socket.emit('registered', { 
        type: 'server', 
        serverId: serverId,
        sessionId: socket.sessionId
      });
      
      // Check if viewer is waiting
      if (viewers.has(serverId)) {
        const viewer = viewers.get(serverId);
        console.log(`Pairing server ${serverId} with waiting viewer`);
        viewer.emit('server-connected', { serverId, sessionId: socket.sessionId });
        socket.emit('viewer-connected', { serverId, sessionId: viewer.sessionId });
      }
      
      console.log(`Active servers: ${stats.activeServers}, viewers: ${stats.activeViewers}`);
    });

    // Viewer registration  
    socket.on('register-viewer', (serverId) => {
      console.log(`Viewer registered for server: ${serverId} (Socket: ${socket.id})`);
      
      // Remove from servers if accidentally registered there
      if (servers.has(serverId) && servers.get(serverId).id === socket.id) {
        servers.delete(serverId);
        stats.activeServers--;
      }
      
      // Store viewer
      viewers.set(serverId, socket);
      socket.serverId = serverId;
      socket.clientType = 'viewer';
      stats.activeViewers++;
      
      // Notify viewer of registration success
      socket.emit('registered', { 
        type: 'viewer', 
        serverId: serverId,
        sessionId: socket.sessionId
      });
      
      // Check if server is available
      if (servers.has(serverId)) {
        const server = servers.get(serverId);
        console.log(`Pairing viewer with server ${serverId}`);
        server.emit('viewer-connected', { serverId, sessionId: socket.sessionId });
        socket.emit('server-connected', { serverId, sessionId: server.sessionId });
      } else {
        console.log(`Viewer waiting for server: ${serverId}`);
        socket.emit('waiting-for-server', { serverId });
      }
      
      console.log(`Active servers: ${stats.activeServers}, viewers: ${stats.activeViewers}`);
    });

    // Relay screen data from server to viewer
    socket.on('screenData', (data) => {
      if (socket.clientType === 'server' && viewers.has(socket.serverId)) {
        const viewer = viewers.get(socket.serverId);
        viewer.emit('screenData', data);
        
        // Track data transfer
        if (data.image) {
          stats.dataTransferred += data.image.length;
        }
      }
    });

    // Relay video data from server to viewer
    socket.on('videoData', (data) => {
      if (socket.clientType === 'server' && viewers.has(socket.serverId)) {
        const viewer = viewers.get(socket.serverId);
        viewer.emit('videoData', data);
        
        // Track data transfer
        if (data.data) {
          stats.dataTransferred += data.data.length;
        }
      }
    });

    // Relay mouse events from viewer to server
    socket.on('mouseMove', (data) => {
      if (socket.clientType === 'viewer' && servers.has(socket.serverId)) {
        servers.get(socket.serverId).emit('mouseMove', data);
      }
    });

    socket.on('mouseClick', (data) => {
      if (socket.clientType === 'viewer' && servers.has(socket.serverId)) {
        servers.get(socket.serverId).emit('mouseClick', data);
      }
    });

    // Relay keyboard events from viewer to server
    socket.on('keyPress', (data) => {
      if (socket.clientType === 'viewer' && servers.has(socket.serverId)) {
        servers.get(socket.serverId).emit('keyPress', data);
      }
    });

    // Relay chat messages
    socket.on('chatMessage', (data) => {
      const targetMap = socket.clientType === 'server' ? viewers : servers;
      if (targetMap.has(socket.serverId)) {
        targetMap.get(socket.serverId).emit('chatMessage', data);
      }
    });

    // Handle control requests
    socket.on('start-screen-sharing', () => {
      if (socket.clientType === 'viewer' && servers.has(socket.serverId)) {
        servers.get(socket.serverId).emit('start-screen-sharing');
      }
    });

    socket.on('stop-screen-sharing', () => {
      if (socket.clientType === 'viewer' && servers.has(socket.serverId)) {
        servers.get(socket.serverId).emit('stop-screen-sharing');
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
        activeServers: servers.size,
        activeViewers: viewers.size,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id} (${socket.clientType}) - Reason: ${reason}`);
      
      if (socket.clientType === 'server' && socket.serverId) {
        servers.delete(socket.serverId);
        stats.activeServers--;
        
        // Notify viewer of disconnection
        if (viewers.has(socket.serverId)) {
          viewers.get(socket.serverId).emit('server-disconnected', { 
            serverId: socket.serverId, 
            reason 
          });
        }
      } else if (socket.clientType === 'viewer' && socket.serverId) {
        viewers.delete(socket.serverId);
        stats.activeViewers--;
        
        // Notify server of disconnection
        if (servers.has(socket.serverId)) {
          servers.get(socket.serverId).emit('viewer-disconnected', { 
            serverId: socket.serverId, 
            reason 
          });
        }
      }
      
      console.log(`Active servers: ${servers.size}, viewers: ${viewers.size}`);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

// Start the server - Railway uses PORT environment variable
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Screen Relay Service running on port ${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats`);
  console.log(`🌐 Landing: http://localhost:${PORT}/`);
  console.log(`🔌 Socket.IO: ws://localhost:${PORT}/socket.io/`);
});

// Export for testing
module.exports = { app, server, io };
