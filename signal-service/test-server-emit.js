const { Server } = require("socket.io");
const { createServer } = require("http");
const { io: Client } = require("socket.io-client");

const httpServer = createServer();
const io = new Server(httpServer);

io.on("connection", (socket) => {
  socket.on("join", () => {
    socket.join("123");
    console.log("Socket joined 123");
    
    // Test server-side emit after 500ms
    setTimeout(() => {
      console.log("Server emitting to 123...");
      io.to("123").emit("hello", "world");
    }, 500);
  });
});

httpServer.listen(() => {
  const port = httpServer.address().port;
  const clientSocket = Client(`http://localhost:${port}`);
  
  clientSocket.on("connect", () => {
    clientSocket.emit("join");
  });
  
  clientSocket.on("hello", (msg) => {
    console.log("Client received:", msg);
    process.exit(0);
  });
});
