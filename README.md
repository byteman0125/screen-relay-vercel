# Screen Relay Service

WebSocket relay service for remote screen sharing across countries/networks.

## 🚀 Deployment

### Deploy to Vercel:
```bash
npm install -g vercel
vercel login
vercel --prod
```

### Your relay URL will be:
```
https://your-project-name.vercel.app
```

## 📡 API Endpoints

### Health Check
```
GET /
```
Returns service status and stats.

### Statistics
```
GET /stats
```
Returns detailed connection statistics.

### WebSocket Connection
```
wss://your-relay-url.vercel.app/socket.io/
```

## 🔧 Client Integration

### Tester Registration:
```javascript
socket.emit('register-tester', 'unique-tester-id');
```

### Supporter Registration:
```javascript
socket.emit('register-supporter', 'tester-id-to-connect');
```

### Events Relayed:
- `screenData` - Screen capture data
- `videoData` - Video stream data  
- `mouseMove` - Mouse movement
- `mouseClick` - Mouse clicks
- `keyPress` - Keyboard input
- `chatMessage` - Chat messages
- `start-screen-sharing` - Control commands
- `stop-screen-sharing` - Control commands

## 📊 Connection Flow

1. **Tester connects**: `register-tester` with unique ID
2. **Supporter connects**: `register-supporter` with tester ID  
3. **Automatic pairing**: Both get notified when paired
4. **Data relay**: All events automatically forwarded
5. **Disconnection handling**: Clean cleanup on disconnect

## 🌟 Features

- ✅ Cross-country connection support
- ✅ NAT/Firewall bypass
- ✅ Automatic pairing system
- ✅ Real-time data relay
- ✅ Connection statistics
- ✅ Error handling
- ✅ Heartbeat/ping support
- ✅ Scalable serverless architecture

## 🔒 Security

- CORS enabled for all origins
- WebSocket + polling fallback
- Automatic session management
- Clean disconnection handling
