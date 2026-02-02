import type { LuckPermsAdapter, LuckPermsContext, PlayerIdentity } from "./adapters";

type HttpAdapterOptions = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
};

// LuckPerms Web API 호출 기반 어댑터 (HTTP 연동)
export class HttpLuckPermsAdapter implements LuckPermsAdapter {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: HttpAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async hasPermission(
    player: PlayerIdentity,
    node: string,
    context?: LuckPermsContext,
  ): Promise<boolean> {
    const payload = {
      uuid: player.uuid,
      node,
      context,
    };
    const response = await this.request("/permission/check", payload);
    return Boolean(response?.allowed);
  }

  async isOperator(player: PlayerIdentity): Promise<boolean> {
    return this.hasPermission(player, "minecraft.op");
  }

  async listGroups(player: PlayerIdentity): Promise<string[]> {
    const response = await this.request("/groups", { uuid: player.uuid });
    return Array.isArray(response?.groups) ? response.groups : [];
  }

  private async request(path: string, body: Record<string, unknown>) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LuckPerms API 오류 (${response.status})`);
      }
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
