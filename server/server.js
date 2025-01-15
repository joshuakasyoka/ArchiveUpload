const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

// Enhanced security middleware
app.use(helmet());

// Configure CORS for specific origins
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Configure multer with additional security checks
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with sanitized extension
    const ext = path.extname(file.originalname).toLowerCase();
    const validExtensions = ['.mp4', '.webm', '.mov'];
    const finalExt = validExtensions.includes(ext) ? ext : '.mp4';
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${finalExt}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Enhanced mime type checking
    const validTypes = [
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-msvideo',
      'application/octet-stream'
    ];
    
    if (!validTypes.includes(file.mimetype) && 
        !file.mimetype.startsWith('video/')) {
      return cb(new Error('Invalid file type. Only video files are allowed.'));
    }

    // Additional security checks
    if (file.size <= 0) {
      return cb(new Error('Empty file detected.'));
    }

    cb(null, true);
  },
  limits: {
    fileSize: process.env.MAX_FILE_SIZE || 100 * 1024 * 1024, // Default 100MB
    files: 1
  }
});

// Rest of your existing code remains the same until the server listen part

// Enhanced error handling
app.use((err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 
      'An unexpected error occurred' : 
      err.message
  });
});

// Cleanup old files periodically
setInterval(() => {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    fs.readdir(uploadsDir, (err, files) => {
      if (err) return console.error('Cleanup error:', err);
      
      const now = Date.now();
      files.forEach(file => {
        const filePath = path.join(uploadsDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return console.error('File stat error:', err);
          
          // Remove files older than 1 hour
          if (now - stats.mtimeMs > 3600000) {
            fs.unlink(filePath, err => {
              if (err) console.error('File deletion error:', err);
            });
          }
        });
      });
    });
  }
}, 3600000); // Run every hour

// Listen on all network interfaces
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});