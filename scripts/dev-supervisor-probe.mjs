// Keep supervisor identity checks responsive during synchronous snapshot copies.
import { createServer } from "node:net";
import { parentPort, workerData as token } from "node:worker_threads";

const probe = createServer((socket) => {
  socket.setTimeout(1000, () => socket.destroy());
  socket.on("error", () => {});
  let request = "";
  socket.on("data", (data) => {
    request += data;
    if (request.length > token.length) socket.destroy();
  });
  socket.once("end", () => socket.end(request === token ? token : ""));
});
probe.listen(0, "127.0.0.1", () =>
  parentPort.postMessage(probe.address().port),
);
