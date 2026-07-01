import React, { useState } from 'react';
import Editor from './Editor';

function App() {
  const [room, setRoom] = useState('my-room');
  const [username, setUsername] = useState('User-' + Math.floor(Math.random() * 1000));
  const [joined, setJoined] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setJoined(true);
  };

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-96">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">ColaCode</h1>
          <form onSubmit={handleJoin}>
            <div className="mb-4">
              <label className="block text-gray-300 mb-2">Room Name</label>
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div className="mb-6">
              <label className="block text-gray-300 mb-2">Your Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition"
            >
              Join Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-900 flex flex-col">
      <div className="bg-gray-800 p-2 text-white flex justify-between items-center">
        <span className="font-mono text-sm">Room: {room}</span>
        <span className="text-sm">User: {username}</span>
      </div>
      <div className="flex-1">
        <Editor room={room} username={username} />
      </div>
    </div>
  );
}

export default App;