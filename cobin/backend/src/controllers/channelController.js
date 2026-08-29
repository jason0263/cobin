// backend/src/controllers/channelController.js

const Channel = require('../models/Channel');
const Server = require('../models/Server');

// Create a channel within a server
exports.createChannel = async (req, res) => {
  try {
    const { serverId, name, type } = req.body;
    if (!serverId || !name) return res.status(400).json({ message: 'serverId and name are required' });
    // Verify user is member of server
    const server = await Server.findOne({ _id: serverId, members: req.userId });
    if (!server) return res.status(403).json({ message: 'Access denied to server' });
    const channel = await Channel.create({ serverId, name, type: type || 'TEXT' });
    res.status(201).json(channel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create channel' });
  }
};

// Get all channels for a server
exports.getServerChannels = async (req, res) => {
  try {
    const { serverId } = req.params;
    // Verify membership
    const server = await Server.findOne({ _id: serverId, members: req.userId });
    if (!server) return res.status(403).json({ message: 'Access denied' });
    const channels = await Channel.find({ serverId }).sort({ createdAt: 1 });
    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch channels' });
  }
};

// Get a single channel (must belong to server user is member of)
exports.getChannel = async (req, res) => {
  try {
    const { id } = req.params;
    const channel = await Channel.findById(id);
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    // Check user membership in the parent server
    const server = await Server.findOne({ _id: channel.serverId, members: req.userId });
    if (!server) return res.status(403).json({ message: 'Access denied' });
    res.json(channel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error retrieving channel' });
  }
};
