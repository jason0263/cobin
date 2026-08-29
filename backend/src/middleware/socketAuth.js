// backend/src/middleware/socketAuth.js

const jwt = require('jsonwebtoken');

// Socket.IO middleware to authenticate a socket connection using the JWT cookie or token query param
function authenticateSocket(socket, next) {
  // Try to read token from cookie (if client sends cookies) or from query param
  const token = socket.handshake.headers.cookie?.match(/token=([^;]+)/)?.[1] || socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: token missing'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id; // attach userId to socket for later use
    return next();
  } catch (err) {
    return next(new Error('Authentication error: invalid token'));
  }
}

module.exports = { authenticateSocket };
