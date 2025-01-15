import React, { useState, useRef, useEffect } from 'react';
import { Camera, Square, Upload, RefreshCcw } from 'lucide-react';

const VideoRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [recordings, setRecordings] = useState([]);
  
  const mediaRecorderRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Fetch existing recordings
  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/recordings');
      const data = await response.json();
      setRecordings(data);
    } catch (err) {
      console.error('Error fetching recordings:', err);
    }
  };


  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8,opus'
      });
      mediaRecorderRef.current = mediaRecorder;
      
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        setRecordedChunks(chunks);
        const blob = new Blob(chunks, { type: 'video/webm' });
        videoRef.current.src = URL.createObjectURL(blob);
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      setStatus('recording');
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setError('Failed to access camera/microphone');
      setStatus('error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      streamRef.current.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setStatus('recorded');
    }
  };

  const uploadVideo = async () => {
    if (recordedChunks.length === 0) return;
    
    try {
      setStatus('processing');
      setError(null);
      const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
      
      const formData = new FormData();
      formData.append('video', videoBlob, 'recording.webm');

      const response = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      setTranscript(result.transcription);
      setStatus('uploaded');
      
      // Fetch updated recordings
      await fetchRecordings();
    } catch (err) {
      console.error('Error uploading video:', err);
      setError('Failed to upload and process video');
      setStatus('error');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <div className="border rounded-lg p-4 bg-white shadow-sm mb-8">
        {/* Existing recording UI */}
        <div className="aspect-w-16 aspect-h-9 mb-4">
          <video
            ref={videoRef}
            className="w-full h-full rounded-lg bg-gray-100"
            autoPlay
            playsInline
            controls={!isRecording}
          />
        </div>
        
        {/* Recording controls */}
        <div className="flex justify-center gap-4 mb-4">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
              disabled={status === 'processing'}
            >
              <Camera className="w-5 h-5" />
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
            >
              <Square className="w-5 h-5" />
              Stop Recording
            </button>
          )}
          
          {recordedChunks.length > 0 && (
            <button
              onClick={uploadVideo}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              disabled={status === 'processing'}
            >
              <Upload className="w-5 h-5" />
              {status === 'processing' ? 'Processing...' : 'Process & Upload'}
            </button>
          )}
        </div>
        
        {/* Status messages */}
        {error && (
          <div className="text-center text-red-600 mb-4 p-3 bg-red-50 rounded">
            {error}
          </div>
        )}
        
        {status === 'processing' && (
          <div className="text-center text-gray-600 p-3 bg-blue-50 rounded mb-4">
            Processing video and generating transcript...
          </div>
        )}
      </div>

      {/* Previous Recordings */}
      {recordings.length > 0 && (
        <div className="border rounded-lg p-4 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Previous Recordings</h2>
          <div className="grid gap-6">
            {recordings.map((recording) => (
              <div key={recording._id} className="border rounded p-4">
                <div className="flex gap-4">
                  {recording.snapshot && (
                    <img 
                      src={`data:image/jpeg;base64,${recording.snapshot}`}
                      alt="Recording snapshot"
                      className="w-48 h-auto rounded"
                    />
                  )}
                  <div>
                    <p className="text-sm text-gray-500">
                      {new Date(recording.timestamp).toLocaleString()}
                    </p>
                    <p className="mt-2">{recording.transcript}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoRecorder;