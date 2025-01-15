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
    const ext = file.mimetype.includes('quicktime') ? '.mov' : 
               file.mimetype.includes('mp4') ? '.mp4' : '.webm';
    cb(null, Date.now() + ext);
  }
});

const upload = multer({ storage: storage });

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
  }
}
connectToMongo();

// Function to convert video to audio
function convertVideoToAudio(inputPath) {
  const outputPath = inputPath.replace('.webm', '.mp3');
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

// Function to capture snapshot from video
function captureSnapshot(inputPath) {
  const outputPath = inputPath.replace('.webm', '-snapshot.jpg');
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        count: 1,
        folder: 'uploads',
        filename: path.basename(outputPath),
        timestamps: ['1'] // Take snapshot at 1 second
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

// Upload endpoint
app.post('/api/upload', upload.single('video'), async (req, res) => {
  const uploadedFiles = [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    console.log('Received video file:', req.file.originalname);
    uploadedFiles.push(req.file.path);

    // Capture snapshot
    console.log('Capturing snapshot...');
    const snapshotPath = await captureSnapshot(req.file.path);
    uploadedFiles.push(snapshotPath);
    
    // Convert video to audio
    console.log('Converting video to audio...');
    const audioPath = await convertVideoToAudio(req.file.path);
    uploadedFiles.push(audioPath);
    
    // Get transcription from OpenAI
    console.log('Getting transcription...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });

    console.log('Transcription received:', transcription.text);

    // Read snapshot file as Buffer
    const snapshotBuffer = fs.readFileSync(snapshotPath);

    // Store in MongoDB
    const result = await db.collection('recordings').insertOne({
      transcript: transcription.text,
      snapshot: snapshotBuffer.toString('base64'), // Store snapshot as base64
      timestamp: new Date(),
      metadata: {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      }
    });

    // Clean up files
    uploadedFiles.forEach(file => {
      fs.unlink(file, (err) => {
        if (err) console.error('Error deleting file:', file, err);
      });
    });

    res.json({
      success: true,
      transcription: transcription.text,
      recordingId: result.insertedId
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up files on error
    uploadedFiles.forEach(file => {
      fs.unlink(file, (err) => {
        if (err) console.error('Error deleting file:', file, err);
      });
    });
    
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
});

// Get recordings endpoint with snapshots
app.get('/api/recordings', async (req, res) => {
  try {
    const recordings = await db.collection('recordings')
      .find({})
      .sort({ timestamp: -1 })
      .toArray();
    
    res.json(recordings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
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