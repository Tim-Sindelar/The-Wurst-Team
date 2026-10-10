plugins {
    id("com.android.application")
}

android {
    namespace = "ch.ethz.polymapsar"
    compileSdk = 36
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "ch.ethz.polymapsar"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // The page the app opens. Override with -PappUrl=https://... (e.g. a dev server).
        val appUrl = (project.findProperty("appUrl") as String?) ?: "https://02.hackathon.ethz.ch/ar/"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
