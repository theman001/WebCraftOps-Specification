plugins {
    // build.gradle.kts가 요구하는 Java 25 툴체인을 빌드 환경(예: gradle:8-jdk21 도커 이미지)에
    // 로컬로 없어도 자동 다운로드하게 해준다 — 특정 JDK가 미리 설치된 이미지를 찾아 헤맬 필요가 없다.
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

rootProject.name = "bridge-paper"
