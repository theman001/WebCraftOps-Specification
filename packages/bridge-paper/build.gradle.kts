plugins {
    java
}

group = "net.webcraftops"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // repo.papermc.io maven-metadata.xml에서 직접 확인한 최신 안정 버전(2026-08-25 기준).
    compileOnly("io.papermc.paper:paper-api:26.2.build.117-stable")
    // paper-api는 log4j-api만 compile로 노출하지만(log4j-core는 paper-server 런타임에만
    // 있음), 콘솔 스트리밍용 Appender를 만들려면 core 타입이 컴파일 시점에 필요하다.
    // compileOnly라 jar에는 안 들어가고, 실행 중인 서버가 이미 가진 걸 그대로 쓴다.
    // 버전은 paper-api pom이 선언한 log4j-api 2.26.0과 맞춘 값.
    compileOnly("org.apache.logging.log4j:log4j-core:2.26.0")
}

java {
    // 실제 Gradle 의존성 해석으로 확인: paper-api 26.2.build.117-stable은 JVM 25+ 필요.
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

tasks.jar {
    archiveBaseName.set("bridge-paper")
    archiveVersion.set("")
}
