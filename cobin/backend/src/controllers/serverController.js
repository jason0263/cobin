// backend/src/controllers/serverController.js

const Server = require('../models/Server');
const User = require('../models/User');

// Create a new server (community)
exports.createServer = async (req, res) => {
  try {
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ message: 'Server name required' });
    const server = await Server.create({
      name,
      icon: icon || '',
      ownerId: req.userId,
      members: [req.userId],
    });
    res.status(201).json(server);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server creation failed' });
  }
};

// Get all servers the user belongs to
exports.getUserServers = async (req, res) => {
  try {
    const servers = await Server.find({ members: req.userId }).populate('ownerId', 'username avatar');
    res.json(servers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch servers' });
  }
};

// Get a single server by ID (must be member)
exports.getServer = async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.id, members: req.userId })
      .populate('ownerId', 'username avatar')
      .populate('members', 'username avatar status');
    if (!server) return res.status(404).json({ message: 'Server not found' });
    res.json(server);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error retrieving server' });
  }
};

// Add a member to a server (owner only for simplicity)
exports.addMember = async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ message: 'Server not found' });
    if (String(server.ownerId) !== req.userId) return res.status(403).json({ message: 'Only owner can add members' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    if (!server.members.includes(userId)) server.members.push(userId);
    await server.save();
    res.json({ message: 'Member added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to add member' });
  }
};

// Remove a member (owner only)
exports.removeMember = async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ message: 'Server not found' });
    if (String(server.ownerId) !== req.userId) return res.status(403).json({ message: 'Only owner can remove members' });
    const { userId } = req.body;
    server.members = server.members.filter((id) => String(id) !== userId);
    await server.save();
    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to remove member' });
  }
};
