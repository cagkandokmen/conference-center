const { io } = require("socket.io-client");
const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("Connected to signal-service");
  socket.emit("joinRoom", { roomId: "123", displayName: "Tester" }, async (res) => {
    console.log("Joined room:", res);
    
    // Call bot API directly
    try {
      const res = await fetch("http://localhost:3001/api/bot/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: "123" })
      });
      console.log("bot/join response:", await res.json());
    } catch(err) {
      console.error(err);
    }
  });
});

socket.on("peerJoined", (data) => console.log("✅ Received peerJoined:", data));

setTimeout(() => {
  process.exit(0);
}, 2000);
