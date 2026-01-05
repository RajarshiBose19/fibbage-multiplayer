import io from "socket.io-client";
const socket = io.connect("https://fibbage-multiplayer.onrender.com");
export default socket;
