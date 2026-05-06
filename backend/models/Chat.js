const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String },
  text: { type: String },
  time: { type: Date, default: Date.now }
}, { _id: false });

const ChatSchema = new mongoose.Schema({
  sessionId: { type: String, index: true },
  messages: { type: [MessageSchema], default: [] },
  lastRoute: {
    source: String,
    destination: String
  },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Chat', ChatSchema);
