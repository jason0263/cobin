// backend/src/controllers/messageController.js

const Message = require('../models/Message');
const Channel = require('../models/Channel');
const Server = require('../models/Server');

// Post a new message to a channel (text only for now)
exports.postMessage = async (req, res) => {
  try {
    const { channelId, content, attachments } = req.body;
    if (!channelId || !content) return res.status(400).json({ message: 'channelId and content required' });
    // Verify channel exists and user has access via server membership
    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    const server = await Server.findOne({ _id: channel.serverId, members: req.userId });
    if (!server) return res.status(403).json({ message: 'Access denied' });
    const message = await Message.create({
      channelId,
      authorId: req.userId,
      content,
      attachments: attachments || [],
    });
    // Emit via Socket.IO (the server instance is attached to req.app.locals.io in server.js)
    const io = req.app.get('io');
    if (io) {
      io.to(channelId).emit('chatMessage', message);
    }
    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to post message' });
  }
};

// Get recent messages for a channel (pagination optional)
exports.getMessages = async (req, res) => {
  try {
    const { channelId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;
    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    const server = await Server.findOne({ _id: channel.serverId, members: req.userId });
    if (!server) return res.status(403).json({ message: 'Access denied' });
    const messages = await Message.find({ channelId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('authorId', 'username avatar');
    res.json(messages.reverse()); // oldest first
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};
