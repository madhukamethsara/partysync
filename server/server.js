import { createPartySyncServer } from "./app.js";

const port = Number(process.env.PORT) || 3001;
const { httpServer } = createPartySyncServer();

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`PartySync server running on port ${port}`);
});
