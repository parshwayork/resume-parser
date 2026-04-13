import { config } from "./config/env";
import { createApp } from "./app";

const app = createApp();

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});

