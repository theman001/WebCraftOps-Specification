import type { LuckPermsAdapter, LuckPermsContext, PlayerIdentity } from "./adapters";

type PermissionRule = {
  node: string;
  allowed: boolean;
  context?: LuckPermsContext;
};

// LuckPerms 연동을 위한 기본 구현 예시 (메모리 기반)
export class InMemoryLuckPermsAdapter implements LuckPermsAdapter {
  private readonly permissions = new Map<string, PermissionRule[]>();
  private readonly groups = new Map<string, string[]>();

  constructor(seed?: {
    permissions?: Record<string, PermissionRule[]>;
    groups?: Record<string, string[]>;
  }) {
    if (seed?.permissions) {
      Object.entries(seed.permissions).forEach(([uuid, rules]) => {
        this.permissions.set(uuid, rules);
      });
    }
    if (seed?.groups) {
      Object.entries(seed.groups).forEach(([uuid, values]) => {
        this.groups.set(uuid, values);
      });
    }
  }

  async hasPermission(
    player: PlayerIdentity,
    node: string,
    context?: LuckPermsContext,
  ): Promise<boolean> {
    const rules = this.permissions.get(player.uuid) ?? [];
    const match = rules.find((rule) => {
      if (rule.node !== node) {
        return false;
      }
      if (!rule.context || !context) {
        return true;
      }
      if (rule.context.worldId && rule.context.worldId !== context.worldId) {
        return false;
      }
      if (rule.context.serverId && rule.context.serverId !== context.serverId) {
        return false;
      }
      return true;
    });
    return match?.allowed ?? false;
  }

  async isOperator(player: PlayerIdentity): Promise<boolean> {
    return this.hasPermission(player, "minecraft.op");
  }

  async listGroups(player: PlayerIdentity): Promise<string[]> {
    return this.groups.get(player.uuid) ?? [];
  }
}
