package net.webcraftops.bridgepaper;

import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

import java.util.concurrent.Callable;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

// HTTP 핸들러는 별도 스레드에서 실행되지만 Bukkit 월드/블록 API는 메인 스레드에서만 안전하다.
// 여기서 메인 스레드로 넘겨 결과를 기다린 뒤, 정확한 성공/실패를 HTTP 응답에 반영한다.
public final class MainThreadExecutor {
    private final Plugin plugin;

    public MainThreadExecutor(Plugin plugin) {
        this.plugin = plugin;
    }

    public <T> T runSync(Callable<T> task, long timeoutMs) throws Exception {
        Future<T> future = Bukkit.getScheduler().callSyncMethod(plugin, task);
        return future.get(timeoutMs, TimeUnit.MILLISECONDS);
    }
}
