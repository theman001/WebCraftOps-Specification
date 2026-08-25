package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.BridgePaperPlugin;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.Json;
import org.bukkit.Bukkit;

import java.io.IOException;

public final class InfoHandler implements HttpHandler {
    private final BridgePaperPlugin plugin;

    public InfoHandler(BridgePaperPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        String json = "{"
            + "\"name\":\"WebCraftOps Bridge Paper\","
            + "\"version\":\"" + Json.escape(plugin.getDescription().getVersion()) + "\","
            + "\"loader\":\"paper\","
            + "\"mcVersion\":\"" + Json.escape(Bukkit.getBukkitVersion()) + "\","
            + "\"bootId\":\"" + Json.escape(plugin.getBootId()) + "\""
            + "}";
        HttpUtil.sendJson(exchange, 200, json);
    }
}
