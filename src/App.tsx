import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Music, 
  Send, 
  Users, 
  Play, 
  Pause, 
  Plus, 
  Smile,
  Copy,
  Check,
  Volume2,
  Upload,
  Square
} from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';

interface User {
  id: string;
  username: string;
  avatar: string;
  isTyping: boolean;
}

interface Message {
  id: number;
  username: string;
  avatar: string;
  text: string;
  timestamp: string;
}

interface Song {
  id: number;
  title: string;
  artist: string;
  duration: string;
  addedBy: string;
  url: string;
  audioData?: string; // Base64 encoded audio data
}

interface Room {
  code: string;
  users: User[];
  messages: Message[];
  playlist: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [audioCache, setAudioCache] = useState<Map<number, string>>(new Map());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // Determine server URL based on environment
    const getServerUrl = () => {
      if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return 'http://localhost:3001';
        }
      }
      return 'https://musicsync-e6za.onrender.com';
    };

    const serverUrl = getServerUrl();
    console.log('Connecting to server:', serverUrl);

    const newSocket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
      setConnectionError(null);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      setIsConnected(false);
      if (reason === 'io server disconnect') {
        // Server disconnected, try to reconnect
        newSocket.connect();
      }
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setIsConnected(false);
      setConnectionError('Failed to connect to server. Please try again.');
    });

    newSocket.on('room-created', (data) => {
      setRoomCode(data.roomCode);
    });

    newSocket.on('room-joined', (data) => {
      setRoom(data.room);
      // Cache audio data for existing songs
      data.room.playlist.forEach((song: Song) => {
        if (song.audioData && !audioCache.has(song.id)) {
          const audioUrl = `data:audio/mpeg;base64,${song.audioData}`;
          setAudioCache(prev => new Map(prev).set(song.id, audioUrl));
        }
      });
    });

    newSocket.on('room-error', (data) => {
      alert(data.message);
    });

    newSocket.on('new-message', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        messages: [...prev.messages, data.message]
      } : null);
    });

    newSocket.on('user-joined', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        users: [...prev.users, data.user]
      } : null);
    });

    newSocket.on('user-left', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        users: prev.users.filter(u => u.id !== data.userId)
      } : null);
    });

    newSocket.on('users-updated', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        users: data.users
      } : null);
    });

    newSocket.on('user-typing', (data) => {
      if (data.isTyping) {
        setTypingUsers(prev => [...prev.filter(u => u !== data.username), data.username]);
      } else {
        setTypingUsers(prev => prev.filter(u => u !== data.username));
      }
    });

    newSocket.on('playlist-updated', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        playlist: data.playlist
      } : null);
      
      // Cache audio data for new songs
      data.playlist.forEach((song: Song) => {
        if (song.audioData && !audioCache.has(song.id)) {
          const audioUrl = `data:audio/mpeg;base64,${song.audioData}`;
          setAudioCache(prev => new Map(prev).set(song.id, audioUrl));
        }
      });
    });

    newSocket.on('song-changed', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        currentSong: data.song,
        isPlaying: data.isPlaying,
        currentTime: data.currentTime
      } : null);
    });

    newSocket.on('music-sync', (data) => {
      setRoom(prev => prev ? {
        ...prev,
        isPlaying: data.isPlaying,
        currentTime: data.currentTime
      } : null);
      
      // Sync audio playback for all users
      if (audioRef.current && room?.currentSong) {
        const audioUrl = audioCache.get(room.currentSong.id);
        if (audioUrl) {
          audioRef.current.currentTime = data.currentTime;
          if (data.isPlaying) {
            audioRef.current.play().catch(console.error);
          } else {
            audioRef.current.pause();
          }
        }
      }
    });

    return () => {
      newSocket.close();
    };
  }, [audioCache, room?.currentSong]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.messages]);

  // When current song changes, load it for all users
  useEffect(() => {
    if (room?.currentSong && audioRef.current) {
      const audioUrl = audioCache.get(room.currentSong.id);
      if (audioUrl) {
        audioRef.current.src = audioUrl;
        audioRef.current.currentTime = room.currentTime || 0;
        audioRef.current.load();

        if (room.isPlaying) {
          audioRef.current.play().catch(error => {
            console.error('Autoplay failed:', error);
          });
        }
      }
    }
  }, [room?.currentSong, audioCache]);

  // Sync play/pause state for all users
  useEffect(() => {
    if (audioRef.current && room?.currentSong) {
      const audioUrl = audioCache.get(room.currentSong.id);
      if (audioUrl) {
        if (room.isPlaying) {
          audioRef.current.play().catch(error => {
            console.error('Playback error:', error);
          });
        } else {
          audioRef.current.pause();
        }
      }
    }
  }, [room?.isPlaying, audioCache, room?.currentSong]);

  const createRoom = () => {
    if (socket && username.trim()) {
      socket.emit('create-room', { username: username.trim() });
    }
  };

  const joinRoom = () => {
    if (socket && username.trim() && roomCode.trim()) {
      socket.emit('join-room', { 
        roomCode: roomCode.trim().toUpperCase(), 
        username: username.trim() 
      });
    }
  };

  const sendMessage = () => {
    if (socket && message.trim()) {
      socket.emit('send-message', { text: message.trim() });
      setMessage('');
      setShowEmojiPicker(false);
    }
  };

  const handleTyping = (isTyping: boolean) => {
    if (socket) {
      socket.emit('typing', { isTyping });
    }
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    handleTyping(true);
    
    typingTimeoutRef.current = setTimeout(() => {
      handleTyping(false);
    }, 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setSelectedFile(file);
      if (!songTitle) {
        setSongTitle(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const addSong = async () => {
    if (socket && songTitle.trim() && selectedFile) {
      try {
        // Convert file to base64
        const reader = new FileReader();
        reader.onload = async (e) => {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // Convert uint8Array to binary string in chunks to avoid stack overflow
          let binaryString = '';
          const chunkSize = 8192; // Process 8KB at a time
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, Array.from(chunk));
          }
          
          const base64String = btoa(binaryString);
          
          // Create a URL for duration calculation
          const audioUrl = URL.createObjectURL(selectedFile);
          const audio = new Audio(audioUrl);
          
          audio.addEventListener('loadedmetadata', () => {
            const duration = `${Math.floor(audio.duration / 60)}:${Math.floor(audio.duration % 60).toString().padStart(2, '0')}`;
            const songId = Date.now();
            
            // Cache the audio URL locally
            const dataUrl = `data:audio/mpeg;base64,${base64String}`;
            setAudioCache(prev => new Map(prev).set(songId, dataUrl));
            
            socket.emit('add-song', {
              id: songId,
              title: songTitle.trim(),
              artist: songArtist.trim() || 'Unknown Artist',
              duration: duration,
              audioData: base64String
            });
            
            // Clean up
            URL.revokeObjectURL(audioUrl);
          });
        };
        
        reader.readAsArrayBuffer(selectedFile);
        
        setSongTitle('');
        setSongArtist('');
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (error) {
        console.error('Error adding song:', error);
        alert('Error adding song. Please try again.');
      }
    }
  };

  const toggleMusic = () => {
    if (socket && room?.currentSong) {
      const newIsPlaying = !room.isPlaying;
      const currentTime = audioRef.current?.currentTime || 0;
      
      socket.emit('music-control', {
        isPlaying: newIsPlaying,
        currentTime: currentTime
      });
    }
  };

  const stopMusic = () => {
    if (socket && room?.currentSong) {
      socket.emit('music-control', {
        isPlaying: false,
        currentTime: 0
      });
      
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.pause();
      }
    }
  };

  const selectSong = (song: Song) => {
    if (socket) {
      socket.emit('select-song', { song });
    }
  };

  const copyRoomCode = async () => {
    if (room?.code) {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  if (!room) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 max-w-md w-full border border-white/20 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full mb-4">
              <Music className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">MusicSync</h1>
            <p className="text-white/70">Share music and chat with friends</p>
            {!isConnected && !connectionError && (
              <div className="text-yellow-400 text-sm mt-2 flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
                Connecting to server...
              </div>
            )}
            {connectionError && (
              <div className="text-red-400 text-sm mt-2 p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                {connectionError}
              </div>
            )}
            {isConnected && (
              <div className="text-green-400 text-sm mt-2 flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                Connected
              </div>
            )}
          </div>

          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={!isConnected}
            />

            <div className="flex gap-3">
              <button
                onClick={createRoom}
                disabled={!username.trim() || !isConnected}
                className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 px-4 rounded-xl font-medium hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                Create Room
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/20"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-transparent text-white/50">or</span>
              </div>
            </div>

            <input
              type="text"
              placeholder="Enter room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={!isConnected}
            />

            <button
              onClick={joinRoom}
              disabled={!username.trim() || !roomCode.trim() || !isConnected}
              className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white py-3 px-4 rounded-xl font-medium hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              Join Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Hidden audio element for music playback */}
      <audio 
        ref={audioRef} 
        onTimeUpdate={() => {
          if (socket && room?.isPlaying && audioRef.current) {
            const currentTime = audioRef.current.currentTime;
            socket.emit('music-control', {
              isPlaying: true,
              currentTime: currentTime
            });
          }
        }}
        onEnded={() => {
          if (socket) {
            socket.emit('music-control', {
              isPlaying: false,
              currentTime: 0
            });
          }
        }}
      />
      
      <div className="container mx-auto p-4 h-screen flex flex-col max-w-7xl">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 mb-4 border border-white/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                <Music className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold">MusicSync Room</h1>
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-sm">Code: {room.code}</span>
                  <button
                    onClick={copyRoomCode}
                    className="text-white/70 hover:text-white transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-white/70">
                <Users className="w-4 h-4" />
                <span className="text-sm">{room.users.length} online</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                <span className="text-white/70 text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
          {/* Chat Section */}
          <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/20 flex-shrink-0">
              <h2 className="text-white font-semibold">Chat</h2>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-0">
              {room.messages.map((msg) => (
                <div key={msg.id} className="flex gap-3 animate-fade-in">
                  <div 
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: msg.avatar }}
                  >
                    {getInitials(msg.username)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-medium text-sm">{msg.username}</span>
                      <span className="text-white/50 text-xs">{formatTime(msg.timestamp)}</span>
                    </div>
                    <div className="bg-white/10 rounded-lg px-3 py-2 text-white text-sm break-words">
                      {msg.text}
                    </div>
                  </div>
                </div>
              ))}
              
              {typingUsers.length > 0 && (
                <div className="text-white/50 text-sm italic animate-pulse">
                  {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-white/20 flex-shrink-0">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={message}
                    onChange={handleMessageChange}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Type a message..."
                    className="w-full px-4 py-2 pr-12 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={!isConnected}
                  />
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/50 hover:text-white"
                    disabled={!isConnected}
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  
                  {showEmojiPicker && (
                    <div className="absolute bottom-full right-0 mb-2 z-50">
                      <EmojiPicker
                        onEmojiClick={(emoji) => {
                          setMessage(prev => prev + emoji.emoji);
                          setShowEmojiPicker(false);
                        }}
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!message.trim() || !isConnected}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Music & Users Section */}
          <div className="space-y-4 overflow-y-auto">
            {/* Current Song */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-4">
              <h3 className="text-white font-semibold mb-3">Now Playing</h3>
              {room.currentSong ? (
                <div className="space-y-3">
                  <div className="bg-white/10 rounded-xl p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                        <Music className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white font-medium truncate">{room.currentSong.title}</h4>
                        <p className="text-white/70 text-sm truncate">{room.currentSong.artist}</p>
                        <p className="text-white/50 text-xs">{room.currentSong.duration}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={toggleMusic}
                      disabled={!isConnected}
                      className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white hover:from-purple-600 hover:to-pink-600 transition-all transform hover:scale-105 disabled:opacity-50"
                    >
                      {room.isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>
                    <button
                      onClick={stopMusic}
                      disabled={!isConnected}
                      className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all transform hover:scale-105 disabled:opacity-50"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                    <Volume2 className="w-5 h-5 text-white/70" />
                  </div>
                  {room.isPlaying && (
                    <div className="text-center">
                      <div className="inline-flex items-center gap-2 text-green-400 text-sm">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        Playing
                      </div>
                    </div>
                  )}
                  {!room.isPlaying && room.currentTime > 0 && (
                    <div className="text-center">
                      <div className="inline-flex items-center gap-2 text-yellow-400 text-sm">
                        <Pause className="w-3 h-3" />
                        Paused
                      </div>
                    </div>
                  )}
                  {!room.isPlaying && room.currentTime === 0 && (
                    <div className="text-center">
                      <div className="inline-flex items-center gap-2 text-red-400 text-sm">
                        <Square className="w-3 h-3" />
                        Stopped
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-white/50 py-8">
                  <Music className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No song selected</p>
                </div>
              )}
            </div>

            {/* Add Song */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-4">
              <h3 className="text-white font-semibold mb-3">Add Song</h3>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Song title"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  disabled={!isConnected}
                />
                <input
                  type="text"
                  placeholder="Artist (optional)"
                  value={songArtist}
                  onChange={(e) => setSongArtist(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  disabled={!isConnected}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isConnected}
                    className={`flex-1 px-3 py-2 border border-white/20 rounded-lg transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50 ${
                      selectedFile 
                        ? 'bg-green-500/20 text-green-300 border-green-500/50' 
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    {selectedFile ? selectedFile.name.slice(0, 15) + '...' : 'Choose Audio File'}
                  </button>
                  <button
                    onClick={addSong}
                    disabled={!songTitle.trim() || !selectedFile || !isConnected}
                    className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Playlist */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-4">
              <h3 className="text-white font-semibold mb-3">Playlist ({room.playlist.length})</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {room.playlist.map((song) => (
                  <div
                    key={song.id}
                    onClick={() => selectSong(song)}
                    className={`p-3 rounded-lg cursor-pointer transition-all hover:scale-[1.02] ${
                      room.currentSong?.id === song.id 
                        ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-500/50' 
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Music className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white text-sm font-medium truncate">{song.title}</h4>
                        <p className="text-white/70 text-xs truncate">{song.artist} • {song.duration}</p>
                        <p className="text-white/50 text-xs">Added by {song.addedBy}</p>
                      </div>
                      {room.currentSong?.id === song.id && room.isPlaying && (
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse flex-shrink-0"></div>
                      )}
                      {room.currentSong?.id === song.id && !room.isPlaying && room.currentTime > 0 && (
                        <Pause className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                      )}
                      {room.currentSong?.id === song.id && !room.isPlaying && room.currentTime === 0 && (
                        <Square className="w-3 h-3 text-red-400 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))}
                
                {room.playlist.length === 0 && (
                  <div className="text-center text-white/50 py-8">
                    <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No songs in playlist</p>
                  </div>
                )}
              </div>
            </div>

            {/* Online Users */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-4">
              <h3 className="text-white font-semibold mb-3">Online ({room.users.length})</h3>
              <div className="space-y-2">
                {room.users.map((user) => (
                  <div key={user.id} className="flex items-center gap-2">
                    <div 
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: user.avatar }}
                    >
                      {getInitials(user.username)}
                    </div>
                    <span className="text-white text-sm truncate flex-1">{user.username}</span>
                    {user.isTyping && (
                      <span className="text-white/50 text-xs animate-pulse">typing...</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default App;