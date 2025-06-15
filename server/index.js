import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Configure CORS for both development and production
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://music-sync.vercel.app',
  'https://musicsync-e6za.onrender.com'
];

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log('Blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Store rooms and users
const rooms = new Map();
const users = new Map();

// Generate random room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Generate user avatar color
function getAvatarColor(username) {
  const colors = [
    '#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B',
    '#EF4444', '#6366F1', '#8B5A2B', '#059669', '#DC2626'
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create room
  socket.on('create-room', (data) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      users: [],
      messages: [],
      playlist: [],
      currentSong: null,
      isPlaying: false,
      currentTime: 0
    };
    
    rooms.set(roomCode, room);
    socket.emit('room-created', { roomCode });
  });

  // Join room
  socket.on('join-room', (data) => {
    const { roomCode, username } = data;
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' });
      return;
    }

    const user = {
      id: socket.id,
      username,
      avatar: getAvatarColor(username),
      isTyping: false
    };

    users.set(socket.id, { ...user, roomCode });
    room.users.push(user);
    
    socket.join(roomCode);
    socket.emit('room-joined', { 
      room: {
        code: roomCode,
        users: room.users,
        messages: room.messages,
        playlist: room.playlist,
        currentSong: room.currentSong,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime
      }
    });
    
    socket.to(roomCode).emit('user-joined', { user });
    io.to(roomCode).emit('users-updated', { users: room.users });

    // Send welcome message
    const welcomeMessage = {
      id: Date.now(),
      username: 'System',
      avatar: '#6366F1',
      text: `👋 ${username} joined the room`,
      timestamp: new Date().toISOString()
    };
    
    room.messages.push(welcomeMessage);
    io.to(roomCode).emit('new-message', { message: welcomeMessage });
  });

  // Send message
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now(),
      username: user.username,
      avatar: user.avatar,
      text: data.text,
      timestamp: new Date().toISOString()
    };

    const room = rooms.get(user.roomCode);
    if (room) {
      room.messages.push(message);
      io.to(user.roomCode).emit('new-message', { message });
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomCode);
    if (room) {
      const roomUser = room.users.find(u => u.id === socket.id);
      if (roomUser) {
        roomUser.isTyping = data.isTyping;
        socket.to(user.roomCode).emit('user-typing', { 
          userId: socket.id, 
          username: user.username,
          isTyping: data.isTyping 
        });
      }
    }
  });

  // Add song to playlist
  socket.on('add-song', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomCode);
    if (room) {
      const song = {
        id: data.id || Date.now(),
        title: data.title,
        artist: data.artist || 'Unknown Artist',
        duration: data.duration || '0:00',
        addedBy: user.username,
        url: data.url
      };
      
      room.playlist.push(song);
      io.to(user.roomCode).emit('playlist-updated', { playlist: room.playlist });
    }
  });

  // Play/pause music
  socket.on('music-control', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomCode);
    if (room) {
      room.isPlaying = data.isPlaying;
      room.currentTime = data.currentTime || 0;
      
      socket.to(user.roomCode).emit('music-sync', {
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        timestamp: Date.now()
      });
    }
  });

  // Select song
  socket.on('select-song', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomCode);
    if (room) {
      room.currentSong = data.song;
      room.isPlaying = false;
      room.currentTime = 0;
      
      io.to(user.roomCode).emit('song-changed', { 
        song: room.currentSong,
        isPlaying: false,
        currentTime: 0
      });
      
      // Send a chat message when a song is selected
      const message = {
        id: Date.now(),
        username: 'System',
        avatar: '#6366F1',
        text: `🎵 ${user.username} selected "${data.song.title}" by ${data.song.artist}`,
        timestamp: new Date().toISOString()
      };
      
      room.messages.push(message);
      io.to(user.roomCode).emit('new-message', { message });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomCode);
      if (room) {
        room.users = room.users.filter(u => u.id !== socket.id);
        socket.to(user.roomCode).emit('user-left', { userId: socket.id });
        io.to(user.roomCode).emit('users-updated', { users: room.users });
        
        // Send a chat message when user leaves
        const message = {
          id: Date.now(),
          username: 'System',
          avatar: '#6366F1',
          text: `👋 ${user.username} left the room`,
          timestamp: new Date().toISOString()
        };
        
        room.messages.push(message);
        io.to(user.roomCode).emit('new-message', { message });
        
        // Clean up empty rooms
        if (room.users.length === 0) {
          rooms.delete(user.roomCode);
        }
      }
      users.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Allowed origins:', allowedOrigins);
});