// backend/src/routes/server.js

const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');
const auth = require('../middleware/auth');

router.use(auth); // all routes require authentication

router.post('/', serverController.createServer);
router.get('/', serverController.getUserServers);
router.get('/:id', serverController.getServer);
router.post('/:id/members', serverController.addMember);
router.delete('/:id/members', serverController.removeMember);

module.exports = router;
