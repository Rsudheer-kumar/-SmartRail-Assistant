const mongoose = require('mongoose');

module.exports = async function connectDB(uri) {
  const mongoUri = uri || process.env.MONGO_URI || 'mongodb://localhost:27017/smartrail';
  try {
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB connected to', mongoUri);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    throw err;
  }
};
