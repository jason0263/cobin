// backend/src/server.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { Server: SocketIOServer } = require('socket.io');
const authRoutes = require('./routes/auth');
const serverRoutes = require('./routes/server');
const channelRoutes = require('./routes/channel');
const messageRoutes = require('./routes/message');
const { authenticateSocket } = require('./middleware/socketAuth');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*', // adjust in production
    methods: ['GET', 'POST']
  }
});

// Middlewares
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);

// Socket.IO authentication
io.use(authenticateSocket);
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id, 'User:', socket.userId);
  // Join user-specific room for private messages
  socket.join(socket.userId);

  // Handle chat messages
  socket.on('chatMessage', async ({ channelId, content }) => {
    const Message = require('./models/Message');
    const newMsg = await Message.create({
      channelId,
      authorId: socket.userId,
      content,
    });
    io.to(channelId).emit('chatMessage', newMsg);
  });

  // Join channel rooms for real‑time updates
  socket.on('joinChannel', ({ channelId }) => {
    socket.join(channelId);
  });

  socket.on('leaveChannel', ({ channelId }) => {
    socket.leave(channelId);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cobin';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('MongoDB connected');
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});
