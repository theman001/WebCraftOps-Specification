import { startBackendServer } from "./server";

export { startBackendServer };

export const backendBoot = () => {
  return "WebCraftOps 백엔드 부트스트랩 준비";
};

if (process.env.WEBCRAFTOPS_BACKEND_AUTO_START === "true") {
  startBackendServer();
}
