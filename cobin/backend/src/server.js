// backend/src/server.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { Server: SocketIOServer } = require('socket.io');

// Import routes
const authRoutes = require('./routes/auth');
const serverRoutes = require('../routes/server'); // will be adjusted after moving files
const channelRoutes = require('../routes/channel');
const messageRoutes = require('../routes/message');

// Middleware for socket authentication
const { authenticateSocket } = require('./middleware/socketAuth');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS (adjust origin in production)
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Make io accessible in request handlers (e.g., message controller)
app.set('io', io);

// Global middlewares
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests, please try again later.'
});
app.use('/api/auth', authLimiter);

// Routes (protected where needed)
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);

// Socket.IO authentication middleware
io.use(authenticateSocket);
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id, 'User:', socket.userId);
  // Join a personal room for private messages
  socket.join(socket.userId);

  // Join a channel (text or voice) room
  socket.on('joinChannel', ({ channelId }) => {
    socket.join(channelId);
    console.log(`User ${socket.userId} joined channel ${channelId}`);
  });

  socket.on('leaveChannel', ({ channelId }) => {
    socket.leave(channelId);
    console.log(`User ${socket.userId} left channel ${channelId}`);
  });

  // Basic chat message handling (fallback to REST endpoint)
  socket.on('chatMessage', async ({ channelId, content }) => {
    const Message = require('./models/Message');
    const newMsg = await Message.create({
      channelId,
      authorId: socket.userId,
      content,
    });
    io.to(channelId).emit('chatMessage', newMsg);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cobin';
mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('MongoDB connected');
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
