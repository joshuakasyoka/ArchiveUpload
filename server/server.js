const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config();

const app = express();

// Configure multer for video upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with proper extension
    const ext = file.mimetype.includes('quicktime') ? '.mov' : 
                file.mimetype.includes('mp4') ? '.mp4' : '.webm';
    cb(null, `${Date.now()}${ext}`);
  }
});

// Update the multer configuration
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
      console.log('Received file:', {
        originalname: file.originalname,
        mimetype: file.mimetype
      });
      
      // Accept common video formats
      const validTypes = [
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'video/x-msvideo',
        'application/octet-stream' // Sometimes browsers send this for video blobs
      ];
      
      if (validTypes.includes(file.mimetype) || 
          file.mimetype.startsWith('video/') || 
          file.originalname.match(/\.(mp4|webm|mov)$/i)) {
        cb(null, true);
      } else {
        console.log('Rejected file type:', file.mimetype);
        cb(new Error(`Invalid file type: ${file.mimetype}. Only video files are allowed`));
      }
    },
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB limit
    }
  });

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize MongoDB
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;

// Connect to MongoDB
async function connectToMongo() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('videoRecorder');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit if cannot connect to database
  }
}
connectToMongo();

// Function to convert video to audio for transcription
const convertToAudio = (inputPath) => {
  const outputPath = inputPath.replace(/\.(webm|mp4|mov)$/, '.mp3');
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
};

// Function to capture thumbnail
const createThumbnail = (inputPath) => {
  const outputPath = inputPath.replace(/\.(webm|mp4|mov)$/, '-thumb.jpg');
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: ['1'],
        filename: path.basename(outputPath),
        folder: path.dirname(inputPath),
        size: '320x240'
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
};

// Helper function to clean up files
const cleanupFiles = (files) => {
  files.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlink(file, (err) => {
        if (err) console.error('Error deleting file:', file, err);
      });
    }
  });
};

// Upload endpoint
app.post('/api/upload', upload.single('video'), async (req, res) => {
  const files = []; // Track files to clean up

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    console.log('Processing video:', req.file.originalname);
    files.push(req.file.path);

    // Generate thumbnail
    console.log('Creating thumbnail...');
    const thumbnailPath = await createThumbnail(req.file.path);
    files.push(thumbnailPath);

    // Convert to audio for transcription
    console.log('Converting to audio...');
    const audioPath = await convertToAudio(req.file.path);
    files.push(audioPath);

    // Get transcription from OpenAI
    console.log('Transcribing audio...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });

    // Read thumbnail as Buffer
    const thumbnailBuffer = fs.readFileSync(thumbnailPath);

    // Store in MongoDB
    const result = await db.collection('recordings').insertOne({
      transcript: transcription.text,
      thumbnail: thumbnailBuffer.toString('base64'),
      timestamp: new Date(),
      metadata: {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        duration: await getVideoDuration(req.file.path)
      }
    });

    // Clean up temporary files
    cleanupFiles(files);

    res.json({
      success: true,
      transcription: transcription.text,
      recordingId: result.insertedId
    });

  } catch (error) {
    console.error('Upload error:', error);
    cleanupFiles(files);
    
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
});

// Get video duration using ffmpeg
function getVideoDuration(filepath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filepath, (err, metadata) => {
      if (err) reject(err);
      resolve(metadata.format.duration);
    });
  });
}

// Get recordings endpoint
app.get('/api/recordings', async (req, res) => {
  try {
    const recordings = await db.collection('recordings')
      .find({})
      .sort({ timestamp: -1 })
      .toArray();
    
    res.json(recordings);
  } catch (error) {
    console.error('Failed to fetch recordings:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

// Delete recording endpoint
app.delete('/api/recordings/:id', async (req, res) => {
  try {
    const result = await db.collection('recordings').deleteOne({
      _id: new MongoClient.ObjectId(req.params.id)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete recording:', error);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something broke!',
    details: err.message 
  });
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});