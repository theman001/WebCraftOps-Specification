// Bridge(플러그인/모드) 호출에 공통으로 붙일 인증 헤더.
// BRIDGE_TOKEN 환경변수가 설정된 경우에만 X-Bridge-Token을 실어 보낸다.
export const bridgeHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const token = process.env.BRIDGE_TOKEN;
  return {
    ...extra,
    ...(token ? { "X-Bridge-Token": token } : {}),
  };
};
