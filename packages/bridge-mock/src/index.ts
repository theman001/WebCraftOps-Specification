import { startBridgeMockServer } from "./server";

export { startBridgeMockServer };

if (process.env.WEBCRAFTOPS_BRIDGE_MOCK_AUTO_START === "true") {
  startBridgeMockServer();
}
