const { io } = require("socket.io-client");
const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("Connected to signal-service");
  socket.emit("joinRoom", { roomId: "123", displayName: "Tester" }, (res) => {
    console.log("Joined room:", res);
    fetch("http://localhost:3002/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: "123" })
    }).then(r => r.json()).then(console.log).catch(console.error);
  });
});

socket.on("peerJoined", (data) => console.log("✅ Received peerJoined:", data));
socket.on("peerLeft", (data) => console.log("Received peerLeft:", data));

setTimeout(() => {
  console.log("Test finished.");
  process.exit(0);
}, 5000);
