const { io } = require("socket.io-client");

for(let i=1; i<=10; i++) {
  setTimeout(() => {
    const socket = io("http://localhost:3001");
    socket.on("connect", () => {
      socket.emit("joinRoom", { roomId: "123", displayName: `Test User ${i}` }, () => {
        console.log(`Test User ${i} joined!`);
      });
    });
  }, i * 200);
}
